import { NetworkStateType } from 'expo-network';
import { connectionKindOf } from './ExpoNetworkInfo';
import { FixedNetworkInfo } from './FixedNetworkInfo';

describe('network info', () => {
  it('reads Wi-Fi and Ethernet as wifi, mobile data as cellular, no connection as none', () => {
    expect(connectionKindOf({ type: NetworkStateType.WIFI, isConnected: true })).toBe('wifi');
    expect(connectionKindOf({ type: NetworkStateType.ETHERNET, isConnected: true })).toBe('wifi');
    expect(connectionKindOf({ type: NetworkStateType.CELLULAR, isConnected: true })).toBe('cellular');
    expect(connectionKindOf({ type: NetworkStateType.NONE })).toBe('none');
    expect(connectionKindOf({ type: NetworkStateType.WIFI, isConnected: false })).toBe('none');
    expect(connectionKindOf({ type: NetworkStateType.UNKNOWN })).toBe('unknown');
    expect(connectionKindOf(null)).toBe('unknown');
  });

  it('FixedNetworkInfo tells its listeners about a change, once', async () => {
    const net = new FixedNetworkInfo('cellular');
    const seen: string[] = [];
    const off = net.onChange((k) => seen.push(k));
    net.set('wifi');
    net.set('wifi');
    off();
    net.set('none');
    expect(seen).toEqual(['wifi']);
    expect(await net.kind()).toBe('none');
  });
});
