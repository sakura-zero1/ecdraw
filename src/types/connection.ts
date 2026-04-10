export type ConnectionState = 'closed' | 'open';

export interface Connection {
  id: string;
  componentId: string;
  pinAId: string;
  pinBId: string;
  state: ConnectionState;
  pathSvg: string;
  animationDuration: number;
  visible: boolean;        // 连线是否可见
}

export interface ConnectivityMatrix {
  componentId: string;
  connections: Connection[];
}
