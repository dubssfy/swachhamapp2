import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import customerApi from '../../services/customerApi';

export default function ProfileSetupScreen({ navigation }: any) {
  const { user, updateUser } = useAuthStore();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await customerApi.setupProfile({ name: username, role: user?.role || 'customer' });
      updateUser({ name: username });
    } catch (err: any) {
      setError(err?.message || 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Complete Your Profile</Text>
      
      <View style={styles.form}>
        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={(text) => {
            setUsername(text);
            setError('');
          }}
          placeholder="Enter your name"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        
        <TouchableOpacity 
          style={[styles.button, loading && styles.buttonDisabled]} 
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.Surface} />
          ) : (
            <Text style={styles.buttonText}>Save & Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.Background, padding: SPACING.xl },
  title: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.xl, fontWeight: 'bold', color: COLORS.TextPrimary, marginBottom: SPACING.xl, marginTop: SPACING.xxl },
  form: { gap: SPACING.md },
  label: { fontFamily: TYPOGRAPHY.fontFamily, fontSize: TYPOGRAPHY.sizes.sm, fontWeight: '600', color: COLORS.TextPrimary },
  input: { borderWidth: 1, borderColor: COLORS.Border, borderRadius: BORDER_RADIUS.sm, padding: SPACING.md, fontSize: TYPOGRAPHY.sizes.base, backgroundColor: COLORS.Surface },
  error: { color: 'red', fontSize: TYPOGRAPHY.sizes.sm },
  button: { backgroundColor: COLORS.Primary, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, alignItems: 'center', marginTop: SPACING.md },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: COLORS.Surface, fontSize: TYPOGRAPHY.sizes.lg, fontWeight: 'bold' }
});
