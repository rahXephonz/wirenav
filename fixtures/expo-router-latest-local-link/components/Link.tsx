import { Text } from 'react-native';

export function Link({ href }: { href: string; children?: unknown }) {
  return <Text>{href}</Text>;
}
