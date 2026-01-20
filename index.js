/**
 * Create Linked Profile - PRODUCTION (Phoenix Encanto)
 *
 * Railway-deployable endpoint for Retell AI
 * Creates linked profiles (minors/guests) attached to primary account
 *
 * PRODUCTION CREDENTIALS - DO NOT USE FOR TESTING
 * Location: Keep It Cut - Phoenix Encanto (201664)
 *
 * Version: 1.0.2 - Fixed referral source to AI Phone Receptionist (2026-01-20)
 */

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// PRODUCTION Meevo API Configuration
const CONFIG = {
  AUTH_URL: 'https://marketplace.meevo.com/oauth2/token',
  API_URL: 'https://na1pub.meevo.com/publicapi/v1',
  CLIENT_ID: 'f6a5046d-208e-4829-9941-034ebdd2aa65',
  CLIENT_SECRET: '2f8feb2e-51f5-40a3-83af-3d4a6a454abe',
  TENANT_ID: '200507',
  LOCATION_ID: '201664'  // Phoenix Encanto
};

let token = null;
let tokenExpiry = null;

async function getToken() {
  if (token && tokenExpiry && Date.now() < tokenExpiry - 300000) return token;

  const res = await axios.post(CONFIG.AUTH_URL, {
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET
  });

  token = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  return token;
}

async function findClientByPhone(phone, locationId) {
  const authToken = await getToken();
  const normalizedPhone = phone.replace(/\D/g, '').slice(-10);

  const clientsRes = await axios.get(
    `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${locationId}`,
    { headers: { Authorization: `Bearer ${authToken}` }}
  );

  if (clientsRes.data?.data) {
    return clientsRes.data.data.find(c => {
      const clientPhone = (c.primaryPhoneNumber || '').replace(/\D/g, '').slice(-10);
      return clientPhone === normalizedPhone;
    });
  }
  return null;
}

app.post('/create', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      guardian_id,
      parent_phone,
      is_minor = false,
      phone,
      email,
      location_id
    } = req.body;

    const locationId = location_id || CONFIG.LOCATION_ID;

    if (!first_name || !last_name) {
      return res.json({
        success: false,
        error: 'Missing required fields: first_name and last_name'
      });
    }

    let guardianId = guardian_id;
    let guardianClient = null;

    if (!guardianId && parent_phone) {
      console.log(`PRODUCTION: Looking up primary account by phone: ${parent_phone}`);
      guardianClient = await findClientByPhone(parent_phone, locationId);

      if (!guardianClient) {
        return res.json({
          success: false,
          error: 'Primary account holder not found. Create their profile first.'
        });
      }
      guardianId = guardianClient.clientId;
      console.log(`PRODUCTION: Found: ${guardianClient.firstName} ${guardianClient.lastName}`);
    }

    if (!guardianId) {
      return res.json({
        success: false,
        error: 'Missing guardian_id or parent_phone'
      });
    }

    const authToken = await getToken();

    // Check if already exists
    const clientsRes = await axios.get(
      `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${locationId}`,
      { headers: { Authorization: `Bearer ${authToken}` }}
    );

    if (clientsRes.data?.data) {
      const existing = clientsRes.data.data.find(c =>
        c.firstName?.toLowerCase() === first_name.toLowerCase() &&
        c.lastName?.toLowerCase() === last_name.toLowerCase()
      );

      if (existing) {
        const detailRes = await axios.get(
          `${CONFIG.API_URL}/client/${existing.clientId}?TenantId=${CONFIG.TENANT_ID}&LocationId=${locationId}`,
          { headers: { Authorization: `Bearer ${authToken}` }}
        );
        const detail = detailRes.data?.data || detailRes.data;

        return res.json({
          success: true,
          client_id: existing.clientId,
          name: `${existing.firstName} ${existing.lastName}`,
          is_minor: detail?.isMinor || false,
          guardian_id: detail?.guardianId || null,
          guardian_name: detail?.guardianFirstName ? `${detail.guardianFirstName} ${detail.guardianLastName}` : null,
          message: 'Profile already exists',
          existing: true
        });
      }
    }

    // Build profile
    const profileData = {
      FirstName: first_name,
      LastName: last_name,
      ObjectState: 2026,
      OnlineBookingAccess: true,
      IsMinor: is_minor === true || is_minor === 'true',
      GuardianId: guardianId,
      GenderEnum: 92,        // Male (default for barbershop)
      ReferredByEnum: 1250,  // Referral
      ReferredById: "98d508fe-65e9-4736-83cf-b3cc0164634a"  // AI Phone Receptionist
    };

    if (email) {
      profileData.EmailAddress = email;
      profileData.EmailCommOptedInStateEnum = 2086;  // OptedIn
      profileData.IsMarketingEmailEnabled = true;    // Marketing emails enabled
    }

    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      profileData.phoneNumbers = [{  // camelCase required for Meevo API
        type: 21,  // Mobile phone type
        countryCode: "1",
        number: cleanPhone,
        isPrimary: true,
        smsCommOptedInState: 2086  // SMS OptedIn - enables "Opt-in for text notifications"
        // 2086 = OptedIn, 11045715 = DEACTIVATED
      }];
    }

    console.log(`PRODUCTION: Creating: ${first_name} ${last_name} (minor: ${profileData.IsMinor})`);

    const createRes = await axios.post(
      `${CONFIG.API_URL}/client?TenantId=${CONFIG.TENANT_ID}&LocationId=${locationId}`,
      profileData,
      { headers: { Authorization: `Bearer ${authToken}` }}
    );

    if (createRes.status !== 200 && createRes.status !== 201) {
      return res.json({
        success: false,
        error: createRes.data?.error?.message || 'Failed to create profile'
      });
    }

    const clientId = createRes.data?.data?.clientId || createRes.data?.clientId;
    const responseData = createRes.data?.data || createRes.data;

    console.log(`PRODUCTION: Created: ${clientId}`);

    if (!guardianClient) {
      const guardianRes = await axios.get(
        `${CONFIG.API_URL}/client/${guardianId}?TenantId=${CONFIG.TENANT_ID}&LocationId=${locationId}`,
        { headers: { Authorization: `Bearer ${authToken}` }}
      );
      const gData = guardianRes.data?.data || guardianRes.data;
      guardianClient = {
        firstName: gData?.firstName,
        lastName: gData?.lastName,
        primaryPhoneNumber: gData?.phoneNumbers?.[0]?.number
      };
    }

    res.json({
      success: true,
      client_id: clientId,
      name: `${first_name} ${last_name}`,
      is_minor: profileData.IsMinor,
      guardian_id: guardianId,
      guardian_name: responseData?.guardianFirstName
        ? `${responseData.guardianFirstName} ${responseData.guardianLastName}`
        : (guardianClient ? `${guardianClient.firstName} ${guardianClient.lastName}` : null),
      guardian_phone: responseData?.guardianPrimaryPhoneNumber || guardianClient?.primaryPhoneNumber,
      guardian_email: responseData?.guardianEmailAddress,
      message: `${profileData.IsMinor ? 'Minor' : 'Guest'} profile created and linked`,
      existing: false
    });

  } catch (error) {
    console.error('PRODUCTION Error:', error.message);
    res.json({
      success: false,
      error: error.response?.data?.error?.message || error.message
    });
  }
});

app.get('/health', (req, res) => res.json({
  status: 'ok',
  environment: 'PRODUCTION',
  location: 'Phoenix Encanto',
  service: 'create-linked-profile'
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PRODUCTION create-linked-profile running on port ${PORT}`));
