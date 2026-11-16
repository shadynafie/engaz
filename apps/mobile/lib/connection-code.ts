import * as Clipboard from "expo-clipboard";
import { Alert } from "react-native";
import { t } from "./i18n";

export function confirmConnectionCode(code: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    Alert.alert(
      t("Connection code"),
      code,
      [
        { text: t("Cancel"), style: "cancel", onPress: () => resolve(false) },
        {
          text: t("Copy and open"),
          onPress: () => {
            void Clipboard.setStringAsync(code).then(() => resolve(true), reject);
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
