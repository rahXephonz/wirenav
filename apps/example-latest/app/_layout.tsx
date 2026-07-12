import { Stack } from "expo-router";

/** Root navigator: a native stack. Extractor reads the <Stack> element → kind "stack". */
export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Home" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
    </Stack>
  );
}
