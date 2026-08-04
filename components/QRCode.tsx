/**
 * components/QRCode.tsx
 * QR code renderizado como grilla de Views — sin dependencias nativas,
 * sin red (qrcode-generator es JS puro), funciona igual en web y nativo.
 * Una vez montado no necesita conexión: por eso el boleto puede
 * mostrarse offline.
 */
import qrcode from 'qrcode-generator';
import { View } from 'react-native';

type Props = {
  value: string;
  size?: number;
  color?: string;
  background?: string;
};

export default function QRCode({ value, size = 200, color = '#1E0A3C', background = '#FFFFFF' }: Props) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;

  return (
    <View style={{ width: size, height: size, backgroundColor: background }}>
      {Array.from({ length: count }).map((_, row) => (
        <View key={row} style={{ flexDirection: 'row' }}>
          {Array.from({ length: count }).map((_, col) => (
            <View
              key={col}
              style={{
                width: cell,
                height: cell,
                backgroundColor: qr.isDark(row, col) ? color : background,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
