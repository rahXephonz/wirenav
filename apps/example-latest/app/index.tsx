import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router } from "expo-router";

/**
 * Home screen. Exercises three edge shapes for the dogfood graph:
 *  - <Link href="/settings">        → DECLARED edge (string literal from a real screen)
 *  - router.push(`/user/${id}`)     → INFERRED edge (template literal resolves to /user/[id])
 *  - router.push(pendingRoute)      → WN202 diagnostic (target is a runtime value)
 */
export default function Home() {
  const [id] = useState("demo-123");
  // A route computed at runtime — the extractor cannot resolve it statically (WN202).
  const pendingRoute = Math.random() > 0.5 ? "/settings" : "/about";

  return (
    <View>
      <Text>Home</Text>
      <Link href="/settings">Open settings</Link>
      <Pressable onPress={() => router.push(`/user/${id}`)}>
        <Text>Open my profile</Text>
      </Pressable>
      <Pressable onPress={() => router.push(pendingRoute)}>
        <Text>Continue</Text>
      </Pressable>
    </View>
  );
}
