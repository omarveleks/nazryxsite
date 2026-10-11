// The guided tour after sign-up: one stop per feature, each on the page it explains. `path` may use {product}, the
// manufacturer's first matched product.
export const TOUR: { path: string; title: string; text: string; tip?: string }[] = [
  { path: '/m/products#add', title: 'Add your products',
    text: 'Search any medicine and add it, or open “Add many at once” and paste your whole list. Each product is matched to your markets in seconds.',
    tip: 'Add a few now, then press Next.' },
  { path: '/m/products', title: 'Your portfolio at a glance',
    text: 'The dashboard shows how many of your products are in high demand, how much competition each faces, and your strongest classes. Switch markets at the top.' },
  { path: '/m/products/{product}', title: 'One product in depth',
    text: 'Why this market, how crowded it is, which distributors could take it on, the route to approval and the price we suggest. Add it to your launch tracker from here.' },
  { path: '/m/market', title: 'See the market',
    text: 'Each of your markets: its size, where the openings are by class, where registered products come from. Download a market read as a PDF from the top.' },
  { path: '/m/partners', title: 'Find distributors',
    text: 'Every distributor in the market, with how many of your molecules each does not carry yet. Filter by class or molecule. We make every introduction.' },
  { path: '/m/services', title: 'Get help from our team',
    text: 'Tell us what you want in three clicks and we point you to the right help: market entry, dossier and regulatory review, or renewals and compliance.' },
  { path: '/m/plan', title: 'Pick your plan',
    text: 'Compare the three plans. Basic Market Data and Complete Market Access start by card in a minute; for Complete Market Entry we talk first.' },
  { path: '/m', title: 'Your home',
    text: 'Start here every day: what to register first, what moved in your markets, your plan and your work in progress. That is the tour.' },
];
