import { useRouter } from "expo-router";
import { Text } from "react-native";

export default function Index() {
  const router = useRouter();
  const id = "1";
  const seg = "a";
  const rest = "b";
  return (
    <Text
      onPress={() => {
        router.push(`/user/${id}`);
        router.push(`/${seg}/${rest}`);
      }}
    >
      Go
    </Text>
  );
}
