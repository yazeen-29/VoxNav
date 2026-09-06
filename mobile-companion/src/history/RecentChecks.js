import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function summary(item) {
  if (item.domain === 'appointment') {
    if (item.actionType === 'appointment_completion_corrected') return `${item.title} marked incomplete`;
    if (item.decision === 'discontinuity') return `Repeated completion check for ${item.title}`;
    return `${item.title} recorded completed`;
  }
  if (item.decision === 'discontinuity') return `Repeated medication record check for ${item.title}`;
  return `${item.title} recorded`;
}

export default function RecentChecks({ medicationService, appointmentService, refreshKey }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  useEffect(() => {
    let active = true;
    Promise.all([medicationService.listHistory(), appointmentService.listHistory()])
      .then(([medication, appointments]) => { if (active) { setItems([...medication, ...appointments].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).slice(0, 20)); setError(''); } })
      .catch(() => { if (active) setError('Recent checks could not be loaded. Your records remain on this device.'); });
    return () => { active = false; };
  }, [medicationService, appointmentService, refreshKey]);
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.heading}>Recent checks</Text>
    <Text style={styles.copy}>The 20 latest local medication and appointment checks. Only facts that were shown during a repeat check appear here.</Text>
    {error ? <Text accessibilityLiveRegion="polite" style={styles.status}>{error}</Text> : null}
    {!error && !items.length ? <Text style={styles.status}>No local checks yet.</Text> : null}
    {items.map((item) => <View key={`${item.domain}-${item.id}`} style={styles.item}>
      <Text style={styles.name}>{summary(item)}</Text>
      <Text style={styles.copy}>{new Date(item.createdAt).toLocaleString()} · {item.decision === 'discontinuity' ? 'Review needed' : item.resolution === 'corrected' ? 'Corrected' : 'Recorded'}</Text>
      {item.reason ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === `${item.domain}-${item.id}` }} onPress={() => setExpanded((current) => current === `${item.domain}-${item.id}` ? null : `${item.domain}-${item.id}`)} style={styles.why}><Text style={styles.whyText}>Why was I shown this?</Text></Pressable> : null}
      {expanded === `${item.domain}-${item.id}` ? <Text style={styles.copy}>{item.factsShown.map((fact) => fact.type === 'recorded_at' ? `Recorded at ${new Date(fact.value).toLocaleString()}` : fact.value).join(' · ')}</Text> : null}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({ card: { backgroundColor: '#fffaf3', borderWidth: 1, borderColor: '#e9dbca', borderRadius: 18, padding: 18, gap: 10 }, heading: { color: '#34271f', fontSize: 20, fontWeight: '800' }, copy: { color: '#705e51', fontSize: 14, lineHeight: 20 }, status: { color: '#705e51', fontSize: 14, lineHeight: 21 }, item: { borderTopWidth: 1, borderTopColor: '#e9dbca', paddingTop: 12, gap: 6 }, name: { color: '#34271f', fontSize: 16, fontWeight: '700' }, why: { alignSelf: 'flex-start', paddingVertical: 6 }, whyText: { color: '#75432f', fontWeight: '800' } });
