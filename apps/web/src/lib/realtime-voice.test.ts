import { RealtimeVoice } from "@engaz/adapters/browser/realtime-voice";
import type { RealtimeVoiceSession } from "@engaz/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
const session: RealtimeVoiceSession = {
  transport: "openai-webrtc",
  clientSecret: "ephemeral-only",
  expiresAt: 123,
  endpoint: "https://api.openai.com/v1/realtime/calls",
};

function setup(muted = false) {
  const track = { enabled: true, stop: vi.fn() };
  const channel = {
    readyState: "open",
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null as ((event: { data: string }) => void) | null,
  };
  const peer = {
    connectionState: "connected",
    ontrack: null,
    onconnectionstatechange: null as (() => void) | null,
    addTrack: vi.fn(),
    createDataChannel: () => channel,
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "offer" })),
    setLocalDescription: vi.fn(),
    setRemoteDescription: vi.fn(),
    close: vi.fn(),
  };
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      get connectionState() {
        return peer.connectionState;
      }
      ontrack = peer.ontrack;
      get onconnectionstatechange() {
        return peer.onconnectionstatechange;
      }
      set onconnectionstatechange(value) {
        peer.onconnectionstatechange = value;
      }
      addTrack = peer.addTrack;
      createDataChannel = peer.createDataChannel;
      createOffer = peer.createOffer;
      setLocalDescription = peer.setLocalDescription;
      setRemoteDescription = peer.setRemoteDescription;
      close = peer.close;
    },
  );
  vi.stubGlobal(
    "Audio",
    class {
      autoplay = false;
      pause = vi.fn();
      play = vi.fn(async () => undefined);
      srcObject = null;
    },
  );
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
        getAudioTracks: () => [track],
      })),
    },
  });
  const fetch = vi.fn(async () => new Response("answer"));
  vi.stubGlobal("fetch", fetch);
  const callbacks = {
    muted: () => muted,
    onTranscript: vi.fn(),
    onSpeaking: vi.fn(),
    onCaption: vi.fn(),
    onError: vi.fn(),
  };
  const voice = new RealtimeVoice();
  const receive = (event: unknown) => channel.onmessage?.({ data: JSON.stringify(event) });
  return { voice, track, channel, peer, callbacks, fetch, receive };
}

describe("live voice transport", () => {
  it("sends only the ephemeral token and forwards each utterance once to the ordinary thread", async () => {
    const test = setup();
    await test.voice.start(async () => session, test.callbacks);
    expect(test.fetch).toHaveBeenCalledWith(
      session.endpoint,
      expect.objectContaining({
        headers: { authorization: "Bearer ephemeral-only", "content-type": "application/sdp" },
        body: "offer",
      }),
    );
    test.receive({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "turn-1",
      transcript: "Check email",
    });
    test.receive({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "turn-1",
      transcript: "Check email",
    });
    expect(test.callbacks.onTranscript).toHaveBeenCalledExactlyOnceWith("Check email");
    test.voice.speak("The report is ready.");
    const response = test.channel.send.mock.calls
      .map(([value]) => JSON.parse(value))
      .find((value) => value.type === "response.create");
    expect(response.response.conversation).toBe("none");
    expect(response.response.input[0].content[0].text).toBe("The report is ready.");
    test.voice.close();
    expect(test.track.stop).toHaveBeenCalledOnce();
    expect(test.peer.close).toHaveBeenCalledOnce();
  });
  it("mutes the microphone before attaching it when a protected question arrived during startup", async () => {
    const test = setup(true);
    await test.voice.start(async () => session, test.callbacks);
    expect(test.track.enabled).toBe(false);
    test.voice.setMuted(false);
    expect(test.track.enabled).toBe(true);
    test.voice.close();
  });
  it("cleans up a broken connection and can start again", async () => {
    const test = setup();
    await test.voice.start(async () => session, test.callbacks);
    test.peer.connectionState = "disconnected";
    test.peer.onconnectionstatechange?.();
    expect(test.callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("disconnected"));
    expect(test.track.stop).toHaveBeenCalledOnce();
    await test.voice.start(async () => session, test.callbacks);
    expect(test.peer.createOffer).toHaveBeenCalledTimes(2);
    test.voice.close();
  });
  it("stops a late microphone grant after hangup without minting a token", async () => {
    const test = setup();
    let grant!: (value: unknown) => void;
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((resolve) => {
            grant = resolve;
          }),
      },
    });
    const createSession = vi.fn(async () => session);
    const starting = test.voice.start(createSession, test.callbacks);
    test.voice.close();
    grant({ getTracks: () => [test.track], getAudioTracks: () => [test.track] });
    await starting;
    expect(test.track.stop).toHaveBeenCalledOnce();
    expect(createSession).not.toHaveBeenCalled();
  });
});
