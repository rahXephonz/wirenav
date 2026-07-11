# React Navigation extraction

Three confidence tiers. Never blur them: the whole credibility of this extractor rests on
being precise about what it knows vs. what it guesses.

## Tier 1 — Static API (v7): clean AST extraction

```ts
const RootStack = createNativeStackNavigator({
  screens: {
    Home: { screen: HomeScreen, linking: { path: '' } },
    Profile: { screen: ProfileScreen, linking: { path: 'user/:id' } },
  },
});
```

Extract with ts-morph: find calls to `create*Navigator` (native-stack, stack,
bottom-tabs, material-top-tabs, drawer — map factory name → navigator kind), read the
`screens`/`groups` object literals. Nested navigators appear as `screen:` referencing
another navigator const — resolve by identifier within the project. `linking.path`
populates deep-link info on the destination. `if (condition)` inside static config isn't
possible (it's data), which is exactly why this tier is reliable.

## Tier 2 — Dynamic JSX: best-effort + honest diagnostics

```tsx
<Stack.Navigator>
  <Stack.Screen name="Home" component={HomeScreen} />
  {isAdmin && <Stack.Screen name="Admin" component={AdminScreen} />}
  {routes.map(r => <Stack.Screen key={r.name} name={r.name} component={r.comp} />)}
</Stack.Navigator>
```

Handle: literal `name` + identifier `component` (extract); conditional rendering
(extract, flag destination `conditional: true`); `.map()` over an in-file array of object
literals (extract each); spread props `{...screenConfig}` (resolve single-assignment
same-file consts, else diagnostic WN301); computed `name={expr}` (diagnostic WN302,
never guess); `component={() => <X/>}` inline (extract, component = anonymous, note file/line).

Navigator identity: the component that renders `<X.Navigator>`. Nesting: a screen whose
component renders another navigator — resolve one level through the project's component
graph; deeper indirection (HOC-wrapped, lazy(), re-exported) → diagnostic WN303.

## Tier 3 — Edges

**The foundation is explicit markers, not inference.** Provide in `@wirenav/core`
(runtime-free, erased at build):

```ts
import { defineNavEdge } from '@wirenav/annotations';
defineNavEdge<RootStackParamList>('Profile'); // adjacent to the navigate call
```

These produce **declared** edges. Then supplemental **inferred** edges from call sites:
`navigation.navigate('Profile', ...)`, `.push`, `.replace`, `.popTo`, plus
`useNavigation()` variants. Resolution of the string → destination follows React
Navigation's own order: nearest enclosing navigator's screens first, then parents. Same
name in sibling navigators with no enclosing context (call in a shared hook) →
ambiguous: diagnostic WN304, no edge — a wrong edge is worse than a missing one.

Wrapper hooks (`useAppNavigation().goToProfile()`) defeat call-site inference by design.
Do not chase them with interprocedural analysis in v1 — that's the unbounded grind.
The documented answer is: put `defineNavEdge` inside the wrapper.

## ParamList extraction (the TS-only payoff)

```ts
type RootStackParamList = {
  Home: undefined;
  Profile: { userId: string; tab?: 'posts' | 'likes' };
};
```

Locate the ParamList type: (a) type argument of `create*Navigator<T>()`, or (b) the
conventional `*ParamList` type referenced by `NativeStackScreenProps`. Use the ts-morph
**type checker** (not syntax) to expand each member to a canonical printed type — this
resolves aliases, intersections, imported types. `undefined` ⇒ no params. Canonical
printing rules are in nav-format.md; the type checker's default printer is NOT
deterministic enough (import-order dependent aliases) — print from the resolved
structural type.

## Failure-mode documentation is a deliverable

Every WN3xx diagnostic must be listed in the package README with: what pattern triggers
it, why it's statically unresolvable, and the recommended remediation (usually: static
API migration or defineNavEdge). Users forgive missing coverage; they don't forgive
silent wrong output.

## Fixture checklist

Static API basic + nested; dynamic JSX literal screens; conditional screen; map over
const array; spread config (resolvable + diagnostic); duplicate screen names in sibling
navigators; navigate call in shared hook (WN304); defineNavEdge in wrapper; ParamList
with alias + imported type + optional union param.
