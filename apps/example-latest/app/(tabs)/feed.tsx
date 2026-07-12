import { Text, View } from "react-native";
import { Link } from "expo-router";

/** Feed tab. The <Link> to the profile tab is a declared edge (literal, real screen). */
export default function Feed() {
  return (
    <View>
      <Text>Feed</Text>
      <Link href="/(tabs)/profile">Go to profile</Link>
    </View>
  );
}
