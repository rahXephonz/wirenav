import { Text, View } from "react-native";

/** Expo Router special screen (+not-found) → destination flag special:not-found. */
export default function NotFound() {
  return (
    <View>
      <Text>This screen does not exist.</Text>
    </View>
  );
}
