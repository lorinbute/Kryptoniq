// The addresses Sentiq's server on Azure (sentiq.money) calls the exchanges and brokers from (FD-KEYIPS): an API key
// restricted to them can be used only by Sentiq. They are the App Service's outbound addresses ("outboundIpAddresses");
// Azure changes them only when the plan moves to another tier, and then this list is updated.
export const SERVER_IPS = [
  '68.210.130.64',
  '68.210.130.28',
  '68.210.129.102',
  '68.210.131.71',
  '68.210.130.70',
  '68.210.130.73',
  '68.210.131.64',
  '68.210.130.36',
  '68.210.130.38',
  '68.210.131.80',
  '68.210.131.82',
  '68.210.130.44',
  '68.210.171.1',
] as const;

/** As the exchanges' key pages take them: separated by commas, without spaces. */
export const SERVER_IPS_TEXT = SERVER_IPS.join(',');
