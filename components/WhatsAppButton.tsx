import { Ionicons } from '@expo/vector-icons';
import { Linking, Platform, Pressable, StyleSheet } from 'react-native';

const TAB_BAR_HEIGHT = 65;
const WA_URL = 'https://wa.me/59169554296?text=Hola%20CaseritaExpress!%20necesito%20ayuda%20👋';

function openWhatsApp() {
  if (Platform.OS === 'web') {
    window.open(WA_URL, '_blank', 'noopener,noreferrer');
  } else {
    Linking.openURL(WA_URL);
  }
}

export function WhatsAppButton() {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      onPress={openWhatsApp}
    >
      <Ionicons name="logo-whatsapp" size={28} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    bottom: TAB_BAR_HEIGHT + 16,
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.95 }],
  },
});
