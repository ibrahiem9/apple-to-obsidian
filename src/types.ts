export type VoiceLanguage = "auto" | "en" | "ar" | "ur";
export interface AppConfig {
  vaultPath: string;
  appleNotesPath: string;
  statePath: string;
  appPath: string;
  nodePath: string;
  appleNotes: { nightlyHour: number };
  voiceMemos: {
    libraryPath: string;
    outputPath: string;
    statePath: string;
    helperPath: string;
    binaryPath: string;
    modelPath: string;
    segmentSeconds: number;
    segmentation: "single-language";
    language: VoiceLanguage;
    nightlyHour: number;
  };
}
