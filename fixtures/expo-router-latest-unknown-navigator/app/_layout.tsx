// A custom, unrecognized navigator component (not Stack/Tabs/Drawer/Slot). Defined
// locally so the fixture has no unresolved imports. The extractor must fall back to
// kind `unknown` and emit WN203.
function CustomNavigator() {
  return null;
}

export default function Layout() {
  return <CustomNavigator />;
}
