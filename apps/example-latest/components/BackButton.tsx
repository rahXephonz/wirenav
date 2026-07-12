import { Link } from "expo-router";

/**
 * A SHARED component (outside app/, so not itself a route). Its <Link> still produces an
 * edge, but from a synthetic `@shared/...` node → the edge is INFERRED (the origin is not
 * a real screen). Demonstrates the whole-tree edge scan reaching non-route source.
 */
export function BackButton() {
  return <Link href="/">Back home</Link>;
}
