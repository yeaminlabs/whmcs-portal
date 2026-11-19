'use strict';

/** Normalize the several availability shapes returned by WHMCS integrations. */
function domainAvailability(response) {
  const root = response && typeof response === 'object' ? response : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  const status = String(data.status || root.status || '').trim().toLowerCase();
  if (status === 'available') return true;
  if (['unavailable', 'registered', 'reserved', 'taken'].includes(status)) return false;
  for (const key of ['available', 'is_available', 'is_domain_available']) {
    if (typeof data[key] === 'boolean') return data[key];
    if (typeof root[key] === 'boolean') return root[key];
  }
  return null;
}

module.exports = { domainAvailability };
