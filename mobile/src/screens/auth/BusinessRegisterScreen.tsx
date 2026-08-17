import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';

const CUSTOMER_TYPES = [
  { label: 'Hotel / Resort', value: 'HOTEL_RESORT' },
  { label: 'Restaurant', value: 'RESTAURANT' },
  { label: 'Hostel', value: 'HOSTEL' },
  { label: 'Corporate', value: 'CORPORATE' },
  { label: 'Institution', value: 'INSTITUTION' },
  { label: 'Other', value: 'OTHER' },
];

export default function BusinessRegisterScreen({ navigation, route }: any) {
  /*
   * The mobile number verified by OTP on the way into the app. When present it
   * IS the business mobile number: it is pre-filled and locked so the business
   * is never asked for it a second time, and it is what gets stored on the
   * authenticated account record.
   */
  const verifiedMobile: string | undefined = route?.params?.verifiedMobile;
  const [customerType, setCustomerType] = useState('');
  const [otherTypeSpecify, setOtherTypeSpecify] = useState('');
  const [establishmentName, setEstablishmentName] = useState('');
  const [establishmentAddress, setEstablishmentAddress] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [website, setWebsite] = useState('');
  const [contactPersonName, setContactPersonName] = useState('');
  const [designation, setDesignation] = useState('');
  const [mobileNumber, setMobileNumber] = useState(verifiedMobile || '');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [emailId, setEmailId] = useState('');
  const [alternateContactPerson, setAlternateContactPerson] = useState('');
  const [alternateMobileNo, setAlternateMobileNo] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [showTypeModal, setShowTypeModal] = useState(false);
  
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [generalError, setGeneralError] = useState('');

  const { businessRegister, isLoading } = useAuthStore();

  const validate = () => {
    let valid = true;
    const newErrors: { [key: string]: string } = {};

    if (!customerType) {
      newErrors.customerType = 'Please select a customer type';
      valid = false;
    }

    if (customerType === 'OTHER' && !otherTypeSpecify.trim()) {
      newErrors.otherTypeSpecify = 'Please specify the customer type';
      valid = false;
    }

    if (!establishmentName.trim()) {
      newErrors.establishmentName = 'Establishment name is required';
      valid = false;
    } else if (
      establishmentName.trim().length < 2 ||
      establishmentName.trim().length > 255
    ) {
      newErrors.establishmentName =
        'Establishment name must be between 2 and 255 characters';
      valid = false;
    }

    if (!establishmentAddress.trim()) {
      newErrors.establishmentAddress = 'Establishment address is required';
      valid = false;
    } else if (establishmentAddress.trim().length < 5) {
      newErrors.establishmentAddress =
        'Establishment address must be at least 5 characters';
      valid = false;
    }

    const gstRegex =
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;

    if (gstNumber.trim() && !gstRegex.test(gstNumber.trim())) {
      newErrors.gstNumber = 'Invalid GST Number';
      valid = false;
    }

    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i;

    if (panNumber.trim() && !panRegex.test(panNumber.trim())) {
      newErrors.panNumber = 'Invalid PAN Number';
      valid = false;
    }

    if (website.trim()) {
      const websiteRegex =
        /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/[^\s]*)?$/i;

      if (!websiteRegex.test(website.trim())) {
        newErrors.website = 'Invalid website URL';
        valid = false;
      }
    }

    if (!contactPersonName.trim()) {
      newErrors.contactPersonName = 'Contact person name is required';
      valid = false;
    } else if (
      contactPersonName.trim().length < 2 ||
      contactPersonName.trim().length > 255
    ) {
      newErrors.contactPersonName =
        'Contact person name must be between 2 and 255 characters';
      valid = false;
    }

    const mobileRegex = /^[6-9]\d{9}$/;

    if (!mobileNumber.trim()) {
      newErrors.mobileNumber = 'Mobile number is required';
      valid = false;
    } else if (!mobileRegex.test(mobileNumber.trim())) {
      newErrors.mobileNumber = 'Invalid Indian mobile number';
      valid = false;
    }

    if (
      whatsappNumber.trim() &&
      !mobileRegex.test(whatsappNumber.trim())
    ) {
      newErrors.whatsappNumber = 'Invalid Indian mobile number';
      valid = false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailId.trim()) {
      newErrors.emailId = 'Email ID is required';
      valid = false;
    } else if (!emailRegex.test(emailId.trim())) {
      newErrors.emailId = 'Invalid email address';
      valid = false;
    }

    if (
      alternateMobileNo.trim() &&
      !mobileRegex.test(alternateMobileNo.trim())
    ) {
      newErrors.alternateMobileNo = 'Invalid Indian mobile number';
      valid = false;
    }

    if (!password) {
      newErrors.password = 'Password is required';
      valid = false;
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
      valid = false;
    } else if (!/[A-Za-z]/.test(password)) {
      newErrors.password = 'Password must contain at least one letter';
      valid = false;
    } else if (!/\d/.test(password)) {
      newErrors.password = 'Password must contain at least one number';
      valid = false;
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Confirm password is required';
      valid = false;
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
      valid = false;
    }

    setErrors(newErrors);
    return valid;
  };

  const handleRegister = async () => {
    setGeneralError('');
    if (!validate()) {
      setGeneralError('Please fix the errors above.');
      return;
    }

    try {
      await businessRegister({
        customerType,
        otherTypeSpecify: customerType === 'OTHER' ? otherTypeSpecify.trim() : undefined,
        establishmentName: establishmentName.trim(),
        establishmentAddress: establishmentAddress.trim(),
        gstNumber: gstNumber.trim().toUpperCase() || undefined,
        panNumber: panNumber.trim().toUpperCase() || undefined,
        website: website.trim()
          ? (
              website.trim().startsWith('http://') ||
              website.trim().startsWith('https://')
                ? website.trim()
                : `https://${website.trim()}`
            )
          : undefined,
        contactPersonName: contactPersonName.trim(),
        designation: designation.trim() || undefined,
        mobileNumber: mobileNumber.trim(),
        whatsappNumber: whatsappNumber.trim() || undefined,
        emailId: emailId.trim(),
        alternateContactPerson: alternateContactPerson.trim() || undefined,
        alternateMobileNo: alternateMobileNo.trim() || undefined,
        password,
        confirmPassword,
      });
      // Navigation is automatically handled by AppNavigator upon state update
    } catch (err: any) {
      console.error(
        'Business Registration error:',
        err?.response?.data || err?.message || err
      );

      const responseData = err?.response?.data;

      if (Array.isArray(responseData?.errors)) {
        const backendErrors: { [key: string]: string } = {};

        responseData.errors.forEach((item: any) => {
          const field =
            item?.path ||
            item?.param ||
            item?.field;

          if (field && !backendErrors[field]) {
            backendErrors[field] =
              item?.msg ||
              item?.message ||
              'Invalid value';
          }
        });

        if (Object.keys(backendErrors).length > 0) {
          setErrors((previous) => ({
            ...previous,
            ...backendErrors,
          }));
        }
      }

      setGeneralError(
        responseData?.message ||
        err?.message ||
        'Registration failed. Please check the highlighted fields and try again.'
      );
    }
  };

  const getCustomerTypeLabel = () => {
    const found = CUSTOMER_TYPES.find(t => t.value === customerType);
    return found ? found.label : 'Select Customer Type';
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.headerContainer}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="arrow-back" size={24} color={COLORS.Surface} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Business Account</Text>
            <Text style={styles.subtitleText}>Register your establishment</Text>
          </View>

          {/* Form */}
          <View style={styles.formContainer}>
            
            <Text style={styles.sectionTitle}>Company / Establishment Details</Text>

            {/* Customer Type Dropdown */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Customer Type *</Text>
              <TouchableOpacity 
                style={[styles.inputContainer, errors.customerType && styles.inputContainerError]}
                onPress={() => setShowTypeModal(true)}
              >
                <Ionicons name="business-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <Text style={[styles.input, !customerType && { color: COLORS.TextSecondary }]}>
                  {getCustomerTypeLabel()}
                </Text>
                <Ionicons name="chevron-down" size={20} color={COLORS.TextSecondary} />
              </TouchableOpacity>
              {errors.customerType && <Text style={styles.errorText}>{errors.customerType}</Text>}
            </View>

            {customerType === 'OTHER' && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Please Specify *</Text>
                <View style={[styles.inputContainer, errors.otherTypeSpecify && styles.inputContainerError]}>
                  <Ionicons name="list-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Specify other type"
                    placeholderTextColor={COLORS.TextSecondary}
                    value={otherTypeSpecify}
                    onChangeText={(t) => { setOtherTypeSpecify(t); setErrors({...errors, otherTypeSpecify: ''}); }}
                  />
                </View>
                {errors.otherTypeSpecify && <Text style={styles.errorText}>{errors.otherTypeSpecify}</Text>}
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name of Establishment *</Text>
              <View style={[styles.inputContainer, errors.establishmentName && styles.inputContainerError]}>
                <Ionicons name="storefront-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter establishment name"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={establishmentName}
                  onChangeText={(t) => { setEstablishmentName(t); setErrors({...errors, establishmentName: ''}); }}
                  autoCapitalize="words"
                />
              </View>
              {errors.establishmentName && <Text style={styles.errorText}>{errors.establishmentName}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Establishment Address *</Text>
              <View style={[styles.inputContainer, { height: 100, alignItems: 'flex-start', paddingTop: 12 }, errors.establishmentAddress && styles.inputContainerError]}>
                <Ionicons name="location-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                  placeholder="Enter full address"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={establishmentAddress}
                  onChangeText={(t) => { setEstablishmentAddress(t); setErrors({...errors, establishmentAddress: ''}); }}
                  multiline
                />
              </View>
              {errors.establishmentAddress && <Text style={styles.errorText}>{errors.establishmentAddress}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>GST Number</Text>
              <View style={[styles.inputContainer, errors.gstNumber && styles.inputContainerError]}>
                <Ionicons name="document-text-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="15-character GST IN"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={gstNumber}
                  onChangeText={(t) => { setGstNumber(t); setErrors({...errors, gstNumber: ''}); }}
                  autoCapitalize="characters"
                  maxLength={15}
                />
              </View>
              {errors.gstNumber && <Text style={styles.errorText}>{errors.gstNumber}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>PAN Number</Text>
              <View style={[styles.inputContainer, errors.panNumber && styles.inputContainerError]}>
                <Ionicons name="card-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="10-character PAN"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={panNumber}
                  onChangeText={(t) => { setPanNumber(t); setErrors({...errors, panNumber: ''}); }}
                  autoCapitalize="characters"
                  maxLength={10}
                />
              </View>
              {errors.panNumber && <Text style={styles.errorText}>{errors.panNumber}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Website</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="globe-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="https://example.com"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={website}
                  onChangeText={setWebsite}
                  keyboardType="url"
                  autoCapitalize="none"
                />
              </View>
              {errors.website && <Text style={styles.errorText}>{errors.website}</Text>}
            </View>

            <Text style={[styles.sectionTitle, { marginTop: SPACING.md }]}>Contact Person Details</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Contact Person Name *</Text>
              <View style={[styles.inputContainer, errors.contactPersonName && styles.inputContainerError]}>
                <Ionicons name="person-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Full name"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={contactPersonName}
                  onChangeText={(t) => { setContactPersonName(t); setErrors({...errors, contactPersonName: ''}); }}
                  autoCapitalize="words"
                />
              </View>
              {errors.contactPersonName && <Text style={styles.errorText}>{errors.contactPersonName}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Designation</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="briefcase-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Manager, Owner"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={designation}
                  onChangeText={setDesignation}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Mobile Number *</Text>
              <View style={[styles.inputContainer, errors.mobileNumber && styles.inputContainerError]}>
                <Ionicons name="call-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="10-digit mobile number"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={mobileNumber}
                  onChangeText={(t) => { setMobileNumber(t); setErrors({...errors, mobileNumber: ''}); }}
                  keyboardType="phone-pad"
                  maxLength={10}
                  editable={!verifiedMobile}
                />
                {verifiedMobile ? (
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.Primary} />
                ) : null}
              </View>
              {verifiedMobile ? (
                <Text style={styles.hintText}>Verified during OTP registration</Text>
              ) : null}
              {errors.mobileNumber && <Text style={styles.errorText}>{errors.mobileNumber}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>WhatsApp Number</Text>
              <View style={[styles.inputContainer, errors.whatsappNumber && styles.inputContainerError]}>
                <Ionicons name="logo-whatsapp" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="10-digit WhatsApp number"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={whatsappNumber}
                  onChangeText={(t) => { setWhatsappNumber(t); setErrors({...errors, whatsappNumber: ''}); }}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
              {errors.whatsappNumber && <Text style={styles.errorText}>{errors.whatsappNumber}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email ID *</Text>
              <View style={[styles.inputContainer, errors.emailId && styles.inputContainerError]}>
                <Ionicons name="mail-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Email address"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={emailId}
                  onChangeText={(t) => { setEmailId(t); setErrors({...errors, emailId: ''}); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              {errors.emailId && <Text style={styles.errorText}>{errors.emailId}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Alternate Contact Person</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="person-add-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Optional alternate contact"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={alternateContactPerson}
                  onChangeText={setAlternateContactPerson}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Alternate Mobile No</Text>
              <View style={[styles.inputContainer, errors.alternateMobileNo && styles.inputContainerError]}>
                <Ionicons name="call-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="10-digit alternate mobile"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={alternateMobileNo}
                  onChangeText={(t) => { setAlternateMobileNo(t); setErrors({...errors, alternateMobileNo: ''}); }}
                  keyboardType="phone-pad"
                  maxLength={10}
                />
              </View>
              {errors.alternateMobileNo && <Text style={styles.errorText}>{errors.alternateMobileNo}</Text>}
            </View>

            <Text style={[styles.sectionTitle, { marginTop: SPACING.md }]}>Account Security</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password *</Text>
              <View style={[styles.inputContainer, errors.password && styles.inputContainerError]}>
                <Ionicons name="lock-closed-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Create a password"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setErrors({...errors, password: ''}); }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={COLORS.TextSecondary} />
                </TouchableOpacity>
              </View>
              {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password *</Text>
              <View style={[styles.inputContainer, errors.confirmPassword && styles.inputContainerError]}>
                <Ionicons name="lock-closed-outline" size={20} color={COLORS.TextSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm your password"
                  placeholderTextColor={COLORS.TextSecondary}
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); setErrors({...errors, confirmPassword: ''}); }}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                  <Ionicons name={showConfirmPassword ? "eye-off-outline" : "eye-outline"} size={20} color={COLORS.TextSecondary} />
                </TouchableOpacity>
              </View>
              {errors.confirmPassword && <Text style={styles.errorText}>{errors.confirmPassword}</Text>}
            </View>

            {/* General Error Message */}
            {generalError ? (
              <View style={styles.generalErrorContainer}>
                <Ionicons name="alert-circle-outline" size={16} color="#D32F2F" />
                <Text style={styles.generalErrorText}>{generalError}</Text>
              </View>
            ) : null}

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.registerButton, isLoading && styles.registerButtonDisabled]}
              onPress={handleRegister}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <>
                  <ActivityIndicator size="small" color={COLORS.Surface} />
                  <Text style={styles.registerButtonText}>Registering...</Text>
                </>
              ) : (
                <Text style={styles.registerButtonText}>Register Business</Text>
              )}
            </TouchableOpacity>
            
            <View style={styles.loginContainer}>
              <Text style={styles.loginText}>Already have an account? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('LoginScreen')}>
                <Text style={styles.loginLink}>Login</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Custom Dropdown Modal */}
      <Modal visible={showTypeModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowTypeModal(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Customer Type</Text>
            <FlatList
              data={CUSTOMER_TYPES}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    setCustomerType(item.value);
                    setErrors({ ...errors, customerType: '' });
                    setShowTypeModal(false);
                  }}
                >
                  <Text style={[styles.modalOptionText, customerType === item.value && styles.modalOptionTextActive]}>
                    {item.label}
                  </Text>
                  {customerType === item.value && (
                    <Ionicons name="checkmark" size={20} color={COLORS.Primary} />
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.Primary,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  headerContainer: {
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl,
    paddingHorizontal: SPACING.xl,
  },
  backButton: {
    marginBottom: SPACING.lg,
  },
  headerTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: 'bold',
    color: COLORS.Surface,
    marginBottom: SPACING.xs,
  },
  subtitleText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.Surface,
    opacity: 0.9,
  },
  formContainer: {
    flex: 1,
    backgroundColor: COLORS.Surface,
    borderTopLeftRadius: BORDER_RADIUS.xl * 1.5,
    borderTopRightRadius: BORDER_RADIUS.xl * 1.5,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xxl,
    paddingBottom: SPACING.xxl,
  },
  sectionTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    marginBottom: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.Border,
    paddingBottom: SPACING.xs,
  },
  inputGroup: {
    marginBottom: SPACING.lg,
  },
  label: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: '600',
    color: COLORS.TextPrimary,
    marginBottom: SPACING.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.Border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    height: 55,
    backgroundColor: COLORS.Background,
  },
  inputContainerError: {
    borderColor: '#D32F2F',
  },
  inputIcon: {
    marginRight: SPACING.sm,
  },
  input: {
    flex: 1,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
  },
  errorText: {
    marginTop: 4,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: '#D32F2F',
  },
  hintText: {
    marginTop: 4,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.xs,
    color: COLORS.Primary,
  },
  generalErrorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  generalErrorText: {
    marginLeft: 5,
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.sm,
    color: '#D32F2F',
    flex: 1,
  },
  registerButton: {
    backgroundColor: COLORS.Primary,
    height: 55,
    borderRadius: BORDER_RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    ...SHADOWS.medium,
    marginBottom: SPACING.xl,
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  registerButtonDisabled: {
    opacity: 0.7,
  },
  registerButtonText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.Surface,
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextSecondary,
  },
  loginLink: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: 'bold',
    color: COLORS.Primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.Surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    maxHeight: '80%',
  },
  modalTitle: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: 'bold',
    color: COLORS.TextPrimary,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.Border,
  },
  modalOptionText: {
    fontFamily: TYPOGRAPHY.fontFamily,
    fontSize: TYPOGRAPHY.sizes.base,
    color: COLORS.TextPrimary,
  },
  modalOptionTextActive: {
    color: COLORS.Primary,
    fontWeight: 'bold',
  },
});