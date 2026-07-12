import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

/** Catch-all route → typed param `slug: string[]`. */
export default function BlogPost() {
  const { slug } = useLocalSearchParams<{ slug: string[] }>();
  return (
    <View>
      <Text>Blog {slug?.join("/")}</Text>
    </View>
  );
}
