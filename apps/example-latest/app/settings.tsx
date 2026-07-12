import { Text, View } from "react-native";
import { BackButton } from "../components/BackButton";

/** Plain screen; the target of the home screen's declared edge. */
export default function Settings() {
  return (
    <View>
      <BackButton />
      <Text>Settings</Text>
    </View>
  );
}
