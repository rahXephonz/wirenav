import { Text, View } from "react-native";

/**
 * Nested inside a groups-only path — (promo) has no _layout, so this screen attaches to
 * the nearest navigator (marketing). Both group segments drop from the URL → /deal.
 */
export default function Deal() {
  return (
    <View>
      <Text>Deal of the day</Text>
    </View>
  );
}
