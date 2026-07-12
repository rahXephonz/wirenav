import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

/** Dynamic route → typed param `id: string`. Target of the home screen's template edge. */
export default function User() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View>
      <Text>User {id}</Text>
    </View>
  );
}
