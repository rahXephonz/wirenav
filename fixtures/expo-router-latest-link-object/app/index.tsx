import { Link } from 'expo-router';
import { Text } from 'react-native';

export default function Index() {
  return (
    <Link href={{ pathname: '/user/[id]', params: { id: '1' } }}>
      <Text>Go</Text>
    </Link>
  );
}
