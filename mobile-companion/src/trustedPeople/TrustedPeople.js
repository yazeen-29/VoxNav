import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const WARM = { ink: '#34271f', muted: '#705e51', paper: '#fffaf3', accent: '#9d4e32', line: '#e9dbca' };

export default function TrustedPeople({ service, nativeGate }) {
  const camera = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [people, setPeople] = useState([]);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [flow, setFlow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Camera checks run only after you choose Enroll or Check now.');

  const refresh = async () => {
    try { setPeople(await service.list()); }
    catch (error) { if (error?.message) setMessage(error.message); }
  };
  useEffect(() => { refresh(); }, []);

  async function begin(kind, person = null) {
    if (!nativeGate) { setMessage('Trusted-person checks require the Android development build.'); return; }
    if (kind === 'enroll' && !name.trim()) { setMessage('Enter the trusted person’s name before enrolling.'); return; }
    const result = permission?.granted ? permission : await requestPermission();
    if (!result?.granted) { setMessage('Camera permission is needed for this local, one-time check.'); return; }
    setFlow({ kind, stage: 'closed', person });
    setMessage('Blink, then take a photo while your eyes are closed.');
  }

  async function takePhoto() {
    if (!camera.current || !flow || busy) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.6, exif: true, skipProcessing: true });
      const outcome = await nativeGate.captureBlinkFrame(photo.uri, flow.stage);
      if (flow.stage === 'closed') {
        setFlow({ ...flow, stage: 'open' });
        setMessage('Blink seen. Open both eyes and take the next photo within 15 seconds.');
        return;
      }
      if (flow.kind === 'enroll') {
        const person = await service.enroll({ name, relationship, phone, note }, outcome.embedding);
        setName('');
        setRelationship('');
        setPhone('');
        setNote('');
        setFlow(null);
        await refresh();
        setMessage(`${person.name} was enrolled on this device. Add up to two more samples for better matching; no photo was kept.`);
      } else if (flow.kind === 'addSample') {
        const person = await service.addTemplate(flow.person.id, outcome.embedding);
        setFlow(null);
        await refresh();
        setMessage(`Added local sample ${person.templateCount} of 3 for ${person.name}. No photo was kept.`);
      } else {
        const match = await service.findBest(outcome.embedding, nativeGate.compareEmbeddings);
        setFlow(null);
        setMessage(match ? `Possible match: ${match.name}. Confirm with the person before relying on it.` : 'No local trusted-person match. This does not identify someone.');
      }
    } catch (error) {
      setMessage(error?.message || 'Could not complete this camera check. Try again in good light.');
      if (String(error?.code || '').includes('BLINK')) setFlow({ ...flow, stage: 'closed' });
    } finally { setBusy(false); }
  }

  async function remove(person) {
    try {
      await service.remove(person.id);
      await refresh();
      setMessage(`${person.name} and their local template were removed from this device.`);
    } catch (error) { setMessage(error?.message || 'Could not remove that trusted person.'); }
  }

  return <View style={styles.card}>
    <Text style={styles.cardTitle}>Trusted people — private local directory</Text>
    <Text style={styles.copy}>With permission, keep contact details and up to three encrypted app-local face templates per person to help recognize them on this phone. Photos are deleted after each check. This is not identity proof, anti-spoofing, or a way to make medical or financial decisions.</Text>
    {flow ? <View style={styles.cameraBox}>
      <CameraView ref={camera} style={styles.camera} facing="front" mirror />
      <Text style={styles.cameraPrompt}>{flow.stage === 'closed' ? 'Step 1 of 2: blink and capture while eyes are closed.' : 'Step 2 of 2: open eyes and capture now.'}</Text>
      <Pressable style={styles.button} onPress={takePhoto} disabled={busy}><Text style={styles.buttonText}>{busy ? 'Checking locally…' : 'Take local photo'}</Text></Pressable>
      <Pressable style={styles.secondaryButton} onPress={() => { setFlow(null); setMessage('Camera check cancelled.'); }} disabled={busy}><Text style={styles.secondaryButtonText}>Cancel camera check</Text></Pressable>
    </View> : <>
      <Text style={styles.label}>Trusted person’s name</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Example: Asha" style={styles.input} maxLength={50} />
      <Text style={styles.label}>Relationship (optional)</Text>
      <TextInput value={relationship} onChangeText={setRelationship} placeholder="Example: Daughter" style={styles.input} maxLength={40} />
      <Text style={styles.label}>Phone number (optional)</Text>
      <TextInput value={phone} onChangeText={setPhone} placeholder="Example: +91 98765 43210" style={styles.input} keyboardType="phone-pad" maxLength={30} />
      <Text style={styles.label}>Private note (optional)</Text>
      <TextInput value={note} onChangeText={setNote} placeholder="Example: Usually visits on weekends" style={styles.input} multiline maxLength={280} />
      <View style={styles.actionRow}>
        <Pressable style={styles.button} onPress={() => begin('enroll')}><Text style={styles.buttonText}>Enroll with consent</Text></Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => begin('check')}><Text style={styles.secondaryButtonText}>Check a person now</Text></Pressable>
      </View>
    </>}
    <Text style={styles.status}>{message}</Text>
    <Text style={styles.label}>Enrolled on this phone</Text>
    {!people.length ? <Text style={styles.status}>No trusted people enrolled.</Text> : people.map((person) => <View key={person.id} style={styles.person}><Text style={styles.personName}>{person.name}</Text>{person.relationship ? <Text style={styles.personDetail}>{person.relationship}</Text> : null}{person.phone ? <Text style={styles.personDetail}>{person.phone}</Text> : null}{person.note ? <Text style={styles.personDetail}>{person.note}</Text> : null}<Text style={styles.personDetail}>{person.templateCount} of 3 local samples</Text>{person.templateCount < 3 ? <Pressable onPress={() => begin('addSample', person)}><Text style={styles.addSample}>Add another local sample</Text></Pressable> : null}<Pressable onPress={() => remove(person)}><Text style={styles.remove}>Remove person and local templates</Text></Pressable></View>)}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: WARM.paper, borderWidth: 1, borderColor: WARM.line, borderRadius: 18, padding: 18, gap: 10 },
  cardTitle: { color: WARM.ink, fontSize: 18, fontWeight: '800' }, copy: { color: WARM.muted, lineHeight: 20 }, label: { color: WARM.ink, fontSize: 13, fontWeight: '700', marginTop: 4 }, input: { minHeight: 46, borderWidth: 1, borderColor: '#d9c4ae', borderRadius: 10, backgroundColor: '#fffdfa', padding: 11, color: WARM.ink, textAlignVertical: 'top' }, button: { alignSelf: 'flex-start', borderRadius: 9, backgroundColor: WARM.accent, paddingHorizontal: 14, paddingVertical: 11 }, buttonText: { color: WARM.paper, fontWeight: '800' }, secondaryButton: { alignSelf: 'flex-start', borderRadius: 9, borderWidth: 1, borderColor: '#cba98f', paddingHorizontal: 14, paddingVertical: 10 }, secondaryButtonText: { color: '#75432f', fontWeight: '800' }, actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }, status: { color: WARM.muted, lineHeight: 19, fontSize: 13 }, cameraBox: { gap: 10 }, camera: { width: '100%', height: 300, borderRadius: 12, overflow: 'hidden', backgroundColor: '#201813' }, cameraPrompt: { color: WARM.ink, fontWeight: '700', lineHeight: 20 }, person: { borderTopWidth: 1, borderTopColor: WARM.line, paddingTop: 10, gap: 5 }, personName: { color: WARM.ink, fontWeight: '800' }, personDetail: { color: WARM.muted, lineHeight: 18 }, addSample: { color: WARM.accent, fontWeight: '700' }, remove: { color: '#9b392a', fontWeight: '700' }
});
