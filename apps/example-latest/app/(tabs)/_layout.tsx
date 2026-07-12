import { Tabs } from "expo-router";

/** Nested tab navigator → kind "tabs", one nesting level deep (a second graph column). */
export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="feed" options={{ title: "Feed" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
