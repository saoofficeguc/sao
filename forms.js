/* SAO official forms, taken from the SAO approval templates and the Student Activities Guide.
 * Each form lists its fields, the services checklist and the guide rules shown to the club.
 */
const SAO_FORMS = (() => {
'use strict';

// Services checklists ("Needed Services" boxes on the paper forms)
const SERVICE_GROUPS = {
  it:                { label: 'IT Service', items: ['Projector', 'Microphones', 'Speakers'], other: true },
  marketing:         { label: 'Marketing Service', items: ['MPC Coverage', 'ON SPOT Mail', 'Flyer Distribution', 'Posters in Boxes'] },
  printing:          { label: 'Printing Service', items: ['Banners', 'Posters', 'Flyers'] },
  technical:         { label: 'Technical Service', items: ['Electricity', 'AC/ON'] },
  technicalBooth:    { label: 'Technical Service', items: ['Electricity', 'Furniture team'] },
  furnitureBooth:    { label: 'Furniture Service', items: ['Chairs "2"', 'Table "1"', 'Counter "1"', 'Booth'], specify: true },
  furnitureCeremony: { label: 'Furniture Service', items: ['Chairs', 'Tables', 'Podium', 'Carpet'] },
  logistics:         { label: 'Logistics "by the AWG"', items: ['Cloth', 'Banners', 'Posters', 'Speakers', 'Screen'], other: true },
  logisticsCeremony: { label: 'Logistics "by the AWG"', items: ['Trophies', 'Certificates', 'Banners', 'Cloth', 'Posters'], other: true },
  agreed:            { label: 'Agreed Service', items: ['ONSPOT', 'Social Media', 'Booth'], other: true },
  sponsorTech:       { label: 'Technical Service', items: ['Electricity'] },
  materials:         { label: 'Marketing Materials', items: ['Banners', 'Posters', 'Flyers'] },
  logSponsor:        { label: 'Logistics "by the Sponsors"', items: ['Laptop', 'Desk/Podium'], other: true },
  logFnb:            { label: 'Logistics "by the Sponsors"', items: ['Truck', 'Refrigerator', 'Grill', 'Coffee Machine', 'Display Refrigerator'], other: true },
};

// Working days from today until a date (Egypt weekend: Friday & Saturday)
function workingDaysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  let n = 0;
  while (d < target) { d.setDate(d.getDate() + 1); const wd = d.getDay(); if (wd !== 5 && wd !== 6) n++; }
  return n;
}

// ---- shared field blocks ----
const eventHead = place => [
  { k: 'eventName', t: 'text', label: 'Event Name', req: true, half: true },
  place === 'booth' ? { k: 'boothNo', t: 'text', label: 'Booth No.', req: true, half: true } : { k: 'venue', t: 'text', label: 'Venue', req: true, half: true },
  { k: 'startDate', t: 'date', label: 'Start Date', req: true, half: true },
  { k: 'endDate', t: 'date', label: 'End Date', req: true, half: true },
];
const desc = { k: 'description', t: 'textarea', label: 'Event Description', ph: 'Describe the event and your objectives', req: true };
const slot = { k: 'slot', t: 'radio', label: 'Event Slot', opts: ['Normal Hours', 'After Hours'], req: true };
const marketingPlan = { k: 'marketingPlan', t: 'textarea', label: 'Marketing Plan', req: true, half: true, small: true };
const EVENT_RULES = [
  'Submit at least 10 working days before the event.',
  'ON SPOT mail, posters and flyers: hand in a hard copy and send a soft copy by mail 10 working days before the event.',
  'No publicity, sponsor contact or printing before SAO approval.',
  'Anything that costs money (printing, extra furniture, etc.) needs an Expense Approval.',
];
const SPONSOR_BANNED = 'Not allowed as sponsors: alcohol, energy drinks, power supplements, tobacco, medical service providers, political or religious groups, and competing educational institutions.';

const sponsorAgreementFields = extra => [
  { k: 'sponsorName', t: 'text', label: 'Sponsor Name', req: true, half: true },
  { k: 'category', t: 'text', label: 'Sponsor Category', ph: 'Mention the sponsor industry', req: true, half: true },
  { k: 'boothNo', t: 'text', label: 'Booth No.', req: true, half: true },
  { k: 'agreedFees', t: 'number', label: 'Agreed Fees (EGP)', doc: 'Agreed Fees', req: true, half: true, money: true, min: 0 },
  { k: 'startDate', t: 'date', label: 'Start Date', req: true, half: true },
  { k: 'endDate', t: 'date', label: 'End Date', req: true, half: true },
  { k: 'sponsorDescription', t: 'textarea', label: 'Sponsor Description', ph: 'Describe the sponsor products and services', req: true },
  { k: 'boothType', t: 'radio', label: 'Sponsor Booth', opts: ['GUC Booth', 'Private Booth/Truck'], req: true },
  ...extra,
  { t: 'heading', label: 'Attachments' },
  { k: 'commercialReg', t: 'file', label: 'Commercial registration', req: true, half: true },
  { k: 'taxId', t: 'file', label: 'Tax ID', req: true, half: true },
  { k: 'onSpotDesign', t: 'file', label: 'ON SPOT mail design', half: true },
];

const FORMS = {
  // ---------------- Events ----------------
  general: {
    name: 'General Event Approval', cat: 'Events', blurb: 'Any regular club event on campus.',
    rules: [...EVENT_RULES, 'Venue and booth must be assigned 10 days before the event.'],
    fields: [...eventHead('venue'), marketingPlan, { k: 'eventManager', t: 'text', label: 'Event Manager', req: true, half: true }, desc, slot,
      { k: 'activities', t: 'textarea', label: 'Event Activities', ph: 'List the event agenda', req: true }],
    services: ['it', 'marketing', 'printing', 'technical', 'logistics'], deadline: 10,
  },
  entertainment: {
    name: 'Entertainment Event Approval', cat: 'Events', blurb: 'Concerts, parties, performances and shows.',
    rules: [...EVENT_RULES, 'The venue must be approved by the SAO and the Health & Safety department.', 'Any performance must be approved by SCAD, and the script reviewed by the SAO.'],
    fields: [...eventHead('venue'), marketingPlan, { k: 'eventManager', t: 'text', label: 'Event Manager', req: true, half: true }, desc, slot,
      { k: 'activities', t: 'textarea', label: 'Event Activities', ph: 'List the event agenda', req: true },
      { k: 'performance', t: 'radio', label: 'Is there a performance?', opts: ['No', 'Yes'], req: true, noDoc: true },
      { k: 'script', t: 'file', label: 'Performance script', half: true, reqIf: ['performance', 'Yes'], showIf: ['performance', 'Yes'] },
      { k: 'scadPerformance', t: 'file', label: 'SCAD approval of the performance', half: true, reqIf: ['performance', 'Yes'], showIf: ['performance', 'Yes'] }],
    // Things the SAO Office head must confirm before approving
    saoChecks: [{ key: 'scriptReviewed', label: 'Performance script reviewed by the SAO Office', when: d => d.performance === 'Yes' }],
    services: ['it', 'marketing', 'printing', 'technical', 'logistics'], deadline: 10,
  },
  educational: {
    name: 'Educational Approval', cat: 'Events', blurb: 'Trainings, workshops, conferences, webinars, public talks.',
    rules: [...EVENT_RULES, 'The L&D form must be approved by SCAD before the event approval - attach it below.', 'Send the speakers list to the SAO at the start of the semester for clearance.'],
    fields: [...eventHead('venue'),
      { k: 'speakers', t: 'speakers', label: 'Speakers', n: 3 },
      { k: 'scadApproval', t: 'file', label: 'SCAD Approval (L&D form)', docAppend: 'SCAD Approval', req: true, half: true },
      desc, slot,
      { k: 'content', t: 'textarea', label: 'Event Content', ph: "Describe the speakers' speeches", req: true },
      { k: 'eventType', t: 'radio', label: 'Event Type', docGroup: true, opts: ['Training', 'Workshop', 'Conference', 'Webinar', 'Public Talk', 'Others'], other: true, req: true }],
    services: ['it', 'marketing', 'printing', 'technical'], deadline: 10,
  },
  sports: {
    name: 'Sports Approval', cat: 'Events', blurb: 'Leagues, tournaments and sports days.',
    rules: [...EVENT_RULES, 'The Sports Club and the Sports Department must review and sign before you submit.', 'Book the Sports Center through the Office of Athletics at least 2 weeks ahead.'],
    fields: [...eventHead('venue'),
      { k: 'sportsClubReview', t: 'file', label: 'Sports Club review (signed)', doc: 'Sports Club Review', req: true, half: true },
      { k: 'sportsDeptReview', t: 'file', label: 'Sports Department review (signed)', doc: 'Sports Department Review', req: true, half: true },
      desc, slot,
      { k: 'plan', t: 'textarea', label: 'Event Plan', ph: 'Describe the event rules and structure', req: true },
      { k: 'eventType', t: 'radio', label: 'Event Type', docGroup: true, opts: ['Football', 'Fitness', 'Tennis', 'Volleyball', 'Basketball', 'Others'], other: true, req: true }],
    services: ['it', 'marketing', 'printing', 'technical'], deadline: 10,
  },
  ceremony: {
    name: 'Opening / Closing Approval', cat: 'Events', blurb: 'Club opening and closing ceremonies.',
    rules: [...EVENT_RULES, 'Reserve the venue by mail at least 10 working days before.', 'Any food entering the campus must be approved by the GUC Clinic.', 'Extra furniture requests need an Expense Approval.'],
    fields: [...eventHead('venue'),
      { k: 'cateringPlan', t: 'textarea', label: 'Catering Plan', req: true, half: true, small: true },
      { k: 'entertainmentPlan', t: 'textarea', label: 'Entertainment Plan', req: true, half: true, small: true },
      desc, slot,
      { k: 'timeline', t: 'textarea', label: 'Event Timeline', ph: 'Describe the event timeline', req: true },
      { k: 'clinicApproval', t: 'file', label: 'GUC Clinic approval (if food is served)', half: true }],
    services: ['it', 'furnitureCeremony', 'printing', 'technical', 'logisticsCeremony'], deadline: 10,
  },
  recruitment: {
    name: 'Recruitment Approval', cat: 'Events', blurb: 'Recruiting new members.',
    rules: [...EVENT_RULES, 'No more than two booths for recruitment.', 'State the trainings given to your board members before recruiting.'],
    fields: [...eventHead('booth'), marketingPlan,
      { k: 'boardTraining', t: 'textarea', label: 'Board Training', ph: 'Trainings given to your board members', req: true, half: true, small: true },
      desc,
      { k: 'location', t: 'radio', label: 'Event Location', opts: ['On Campus', 'Online'], req: true },
      { k: 'recruitmentPlan', t: 'textarea', label: 'Recruitment Plan', ph: 'Goals: number of interviewees, members needed, and the marketing tools you will use', req: true }],
    services: ['furnitureBooth', 'marketing', 'printing', 'technicalBooth', 'logistics'], deadline: 10,
  },
  booth: {
    name: 'Marketing Booth Approval', cat: 'Events', blurb: 'A booth to promote your club or an event.',
    rules: [...EVENT_RULES, 'No more than two booths.'],
    fields: [...eventHead('booth'), marketingPlan,
      { k: 'boothManager', t: 'text', label: 'Booth Manager', req: true, half: true },
      desc, slot,
      { k: 'activities', t: 'textarea', label: 'Event Activities', ph: 'List the booth activities', req: true }],
    services: ['furnitureBooth', 'marketing', 'printing', 'technicalBooth', 'logistics'], deadline: 10,
  },

  // ---------------- Sponsorship ----------------
  sponsorAgreement: {
    name: 'Sponsorship Agreement', cat: 'Sponsorship', blurb: 'For all sponsors except food & drinks.', titleKey: 'sponsorName', amountKey: 'agreedFees',
    rules: ['Submit at least 10 working days before the sponsor launches, with the printed ON SPOT mail design.', 'Attach the sponsor\'s commercial registration and Tax ID.',
      'If the sponsor delivers any academic content, SCAD approval must be attached.', 'Electricity: max 6 kW in total and 1.5 kW per device.',
      'One booth per day.', 'Fees are paid by the sponsor to the GUC Cashier in B4 only - students never handle sponsor money.', SPONSOR_BANNED],
    fields: sponsorAgreementFields([
      { k: 'academicContent', t: 'radio', label: 'Does the sponsor deliver academic content?', opts: ['No', 'Yes'], req: true, noDoc: true },
      { k: 'scadApproval', t: 'file', label: 'SCAD Approval', docAppend: 'If the Sponsor delivers', half: true, reqIf: ['academicContent', 'Yes'], showIf: ['academicContent', 'Yes'] },
    ]),
    services: ['agreed', 'marketing', 'sponsorTech', 'materials', 'logSponsor'], deadline: 10, sponsor: true,
  },
  fnbAgreement: {
    name: 'Food & Beverages Sponsorship Agreement', cat: 'Sponsorship', blurb: 'For food & drink sponsors.', titleKey: 'sponsorName', amountKey: 'agreedFees',
    rules: ['Submit at least 10 working days before the sponsor launches, with the printed ON SPOT mail design.', 'The GUC Clinic approves the sponsor\'s products first - the request goes to the Clinic before your Academic Advisor.',
      'The Electricity Department must approve the electric loads of the machines. Max 6 kW total, 1.5 kW per device.', 'Profit-sharing on sales is not allowed - fixed fees only.',
      'One booth per day.', SPONSOR_BANNED],
    fields: sponsorAgreementFields([]),
    services: ['agreed', 'marketing', 'sponsorTech', 'materials', 'logFnb'], deadline: 10, sponsor: true,
    // The GUC Clinic approves the food first; its e-signature goes in the paper's "Clinic Approval" box
    stages: ['clinic', 'advisor', 'sao', 'vp'],
  },

  // ---------------- Finance ----------------
  expense: {
    name: 'Expense Approval', cat: 'Finance', blurb: 'Spending money from the club account. Comes with a memo.', titleKey: 'memoSubject', amountKey: 'amount', memo: true,
    rules: ['A memo is required. Write it below (use "Draft with AI" for help) - it is printed on the official SAO memo template and signed by your Academic Advisor, the Youth Welfare Director and the Vice President.',
      'Attach, if you have them: stamped tax invoice (original invoice number), copies of the tax card, tax registration number and commercial register, proof the items were bought and used, and the security declaration that the items entered the university.',
      'When the Vice President approves, the amount is taken from your club account automatically.',
      'Loans must be settled with all documents within one month.'],
    fields: [
      { k: 'requestedDate', t: 'date', label: 'Requested Date', req: true, half: true, def: ctx => ctx.today },
      { k: 'requestedBy', t: 'text', label: 'Requested by', req: true, half: true, def: ctx => ctx.user.name },
      { k: 'amount', t: 'number', label: 'Request Amount (EGP)', req: true, half: true, money: true, min: 1 },
      { k: 'justification', t: 'textarea', label: 'Justification', req: true },
      { t: 'heading', label: 'Memo' },
      { k: 'memoTo', t: 'text', label: 'To', req: true, half: true, def: ctx => ctx.saoName + ', Youth Welfare Director' },
      { k: 'memoSubject', t: 'text', label: 'Subject', req: true, half: true, ph: 'e.g. Printing banners for Tech Day' },
      { k: 'memoBody', t: 'memo', label: 'Memo text', req: true, ph: 'Write the memo, or fill in the amount, justification and subject and click "Draft with AI".' },
      { t: 'heading', label: 'Attachments (if you have them)' },
      { k: 'att2', t: 'file', label: 'Attachment 2', half: true },
      { k: 'att3', t: 'file', label: 'Attachment 3', half: true },
      { k: 'att4', t: 'file', label: 'Attachment 4', half: true },
      { t: 'heading', label: 'Your signature' },
      { k: 'repSignature', t: 'signature', label: 'Requested by - signature', req: true },
    ],
  },
};
Object.entries(FORMS).forEach(([k, f]) => { f.key = k; f.titleKey = f.titleKey || 'eventName'; f.template = `templates/${k}.docx`; });

const CATS = ['Events', 'Sponsorship', 'Finance'];
// Ticking anything in these groups means the club must upload the design (and hand in a hard copy at the office)
const DESIGN_GROUPS = ['marketing', 'printing'];
// Late submissions (less than the required working days' notice)
const LATE_LIMIT = 4, LATE_BLOCK_MONTHS = 2;
return { FORMS, SERVICE_GROUPS, CATS, DESIGN_GROUPS, LATE_LIMIT, LATE_BLOCK_MONTHS, workingDaysUntil };
})();
// Used by the browser (window.SAO_FORMS) and by the server (require('./forms.js'))
if (typeof window !== 'undefined') window.SAO_FORMS = SAO_FORMS;
if (typeof module !== 'undefined') module.exports = SAO_FORMS;

