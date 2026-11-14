import { SafeAreaView, View, Text, Pressable, StyleSheet } from 'react-native';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.brand}>LakayGoPay</Text>
        <Text style={styles.tagline}>Peye senp. Viv pi senp.</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Bous mwen</Text>
          <Text style={styles.amount}>0.00 HTG</Text>
          <Text style={styles.note}>Mòd devlopman — pa gen lajan reyèl.</Text>
        </View>
        <View style={styles.actions}>
          <Pressable style={styles.button}><Text style={styles.buttonText}>Eskane QR</Text></Pressable>
          <Pressable style={styles.buttonAlt}><Text style={styles.buttonAltText}>Voye lajan</Text></Pressable>
        </View>
        <Text style={styles.section}>Byento sou LakayGoPay</Text>
        <Text style={styles.body}>Kont kliyan ak machann • Istorik • Resi • Notifikasyon</Text>
        <Text style={styles.footer}>LakayGoPay — Premye baz aplikasyon mobil la</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F7FB' },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  brand: { fontSize: 32, fontWeight: '800', color: '#123B70' },
  tagline: { fontSize: 16, color: '#607086', marginTop: 6, marginBottom: 28 },
  card: { backgroundColor: '#123B70', borderRadius: 20, padding: 22, marginBottom: 20 },
  label: { color: '#DCE8F8', fontSize: 14 },
  amount: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', marginTop: 8 },
  note: { color: '#DCE8F8', fontSize: 12, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, backgroundColor: '#1769AA', padding: 16, borderRadius: 14, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700' },
  buttonAlt: { flex: 1, backgroundColor: '#FFFFFF', padding: 16, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: '#D5DFEA' },
  buttonAltText: { color: '#123B70', fontWeight: '700' },
  section: { fontSize: 18, fontWeight: '700', color: '#1A2C42', marginTop: 32, marginBottom: 8 },
  body: { color: '#607086', lineHeight: 22 },
  footer: { color: '#8A98A9', fontSize: 11, marginTop: 40, textAlign: 'center' }
});
