import type {
  AdapterContext,
  AdapterDescriptor,
  RealtimeVoiceSession,
  SpeechClip,
  VoiceCapabilities,
  VoiceInfo,
  VoiceProvider,
  VoiceSynthesizeRequest,
  VoiceTranscribeRequest,
  VoiceVerifyResult,
} from "@engaz/adapter-kit";
import {
  readVoiceAudio,
  readVoiceJson,
  requireOk,
  speechUploadName,
  verifyVoiceHttpGet,
  voiceDeadline,
  voiceHttpError,
} from "./voice-http.js";

const API = "https://api.openai.com/v1";
const TTS_MODEL = "gpt-4o-mini-tts";
const STT_MODEL = "gpt-4o-mini-transcribe";

const OPENAI_VOICES: VoiceInfo[] = [
  { id: "alloy", label: "Alloy", description: "Neutral" },
  { id: "ash", label: "Ash", description: "Clear" },
  { id: "ballad", label: "Ballad", description: "Warm" },
  { id: "coral", label: "Coral", description: "Bright" },
  { id: "echo", label: "Echo", description: "Even" },
  { id: "fable", label: "Fable", description: "Narrative" },
  { id: "onyx", label: "Onyx", description: "Deep" },
  { id: "nova", label: "Nova", description: "Energetic" },
  { id: "sage", label: "Sage", description: "Calm" },
  { id: "shimmer", label: "Shimmer", description: "Soft" },
  { id: "verse", label: "Verse", description: "Expressive" },
];

export class OpenAIVoiceProvider implements VoiceProvider {
  describe(): AdapterDescriptor<VoiceCapabilities> {
    return {
      id: "openai",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { catalog: true, synthesize: true, transcribe: true },
    };
  }

  async createRealtimeSession(
    request: { apiKey: string; voiceId: string },
    context: AdapterContext,
  ): Promise<RealtimeVoiceSession> {
    const voices = new Set(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"]);
    const signal = voiceDeadline(context.signal, 15_000);
    const res = await fetch(`${API}/realtime/client_secrets`, {
      method: "POST",
      headers: { authorization: `Bearer ${request.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 60 },
        session: {
          type: "realtime",
          model: "gpt-realtime-2.1-mini",
          instructions:
            "You are the spoken voice of an Engaz agent. Never answer microphone input independently. When given a passage to read, read only that passage without adding claims or taking actions.",
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice: voices.has(request.voiceId) ? request.voiceId : "alloy" },
          },
          tools: [],
        },
      }),
      signal,
    });
    const body = await readVoiceJson(res, { requireValid: res.ok });
    if (!res.ok) throw new Error(voiceHttpError(res.status, "OpenAI", "starting live voice", body));
    const value = body as { value?: unknown; expires_at?: unknown };
    if (typeof value.value !== "string" || !value.value || typeof value.expires_at !== "number") {
      throw new Error("The voice service returned an invalid session.");
    }
    return {
      transport: "openai-webrtc",
      clientSecret: value.value,
      expiresAt: value.expires_at,
      endpoint: `${API}/realtime/calls`,
    };
  }

  async verify(apiKey: string, context: AdapterContext): Promise<VoiceVerifyResult> {
    return verifyVoiceHttpGet({
      url: `${API}/models`,
      headers: { authorization: `Bearer ${apiKey}` },
      signal: context.signal,
      provider: "OpenAI",
    });
  }

  async listVoices(_apiKey: string, _context: AdapterContext): Promise<VoiceInfo[]> {
    return OPENAI_VOICES;
  }

  async synthesize(request: VoiceSynthesizeRequest, context: AdapterContext): Promise<SpeechClip> {
    const signal = voiceDeadline(request.signal ?? context.signal, 60_000);
    const res = await fetch(`${API}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: request.voiceId,
        input: request.text,
        response_format: "mp3",
      }),
      signal,
    });
    await requireOk(res, "OpenAI", "speaking");
    return { bytes: await readVoiceAudio(res, signal), mimeType: "audio/mpeg" };
  }

  async transcribe(
    request: VoiceTranscribeRequest,
    context: AdapterContext,
  ): Promise<{ text: string }> {
    const form = new FormData();
    form.set("model", STT_MODEL);
    form.set(
      "file",
      new Blob([new Uint8Array(request.audio)], { type: request.mimeType || "audio/webm" }),
      speechUploadName(request.mimeType),
    );
    const res = await fetch(`${API}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${request.apiKey}` },
      body: form,
      signal: voiceDeadline(request.signal ?? context.signal, 60_000),
    });
    const body = await readVoiceJson(res, { requireValid: res.ok });
    if (!res.ok) throw new Error(voiceHttpError(res.status, "OpenAI", "transcribing", body));
    return { text: String((body as { text?: unknown } | null)?.text ?? "").trim() };
  }
}
