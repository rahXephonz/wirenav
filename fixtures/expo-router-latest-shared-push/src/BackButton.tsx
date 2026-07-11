import { useRouter } from "expo-router";
import { Text } from "react-native";

export function BackButton() {
  const router = useRouter();
  return <Text onPress={() => router.push("/settings")}>Back</Text>;
}
