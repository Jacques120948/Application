import type { fr } from './fr'

export const en: Record<keyof typeof fr, string> = {
  'common.appName': 'Evoliia',
  'common.tagline': 'Find an idea. Build it. Launch it. Monetise it. Without coding.',
  'common.loading': 'One moment…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.comingSoon': 'Coming soon',
  'common.error': 'Something went wrong.',
  'common.retry': 'Try again',

  'nav.dashboard': 'My project',
  'nav.ideas': 'My ideas',
  'nav.objective': 'My goal',
  'nav.logout': 'Sign out',
  'nav.login': 'Sign in',
  'nav.register': 'Create account',
  'nav.admin': 'Administration',

  'landing.navCreate': 'What you can build',
  'landing.navHow': 'How it works',
  'landing.navPricing': 'Pricing',
  'landing.metaTitle': 'Evoliia — Build an app with AI, without writing code',
  'landing.metaDescription':
    'Evoliia helps you find an idea, check its potential, build your web app and prepare its launch. Without writing a line of code.',

  'landing.eyebrow': 'Your idea deserves more than a prototype',
  'landing.heroTitle': 'Turn an idea into an app.',
  'landing.heroTitleAccent': 'Without writing code.',
  'landing.heroBody':
    'Evoliia helps you find an idea, check its potential, build your app and prepare its launch.',
  'landing.ctaFindIdea': 'Find my idea',
  'landing.ctaHaveIdea': 'I already have an idea',
  'landing.heroNote': 'Free to start · No card required',
  'landing.heroShotsCaption': 'Demo apps genuinely built with Evoliia.',

  'landing.buildTitle': 'What can you build with Evoliia?',
  'landing.buildBody':
    'From a trade tool to your next micro-SaaS, it all starts with one idea. Here are six apps built with the Evoliia engine: they are live, and you can open them.',
  'landing.buildBadge': 'Example built with Evoliia',
  'landing.buildOpen': 'Open the example',
  'landing.buildSimilar': 'Build something similar',
  'landing.buildNote':
    'These are demos we published ourselves, not customers. The prices shown illustrate a possible business model, never observed revenue.',

  'landing.oneLineTitle': 'One idea is enough to start.',
  'landing.oneLineBody':
    'You describe what you want, in plain words, as you would to a person. Evoliia builds the app, then you change it by continuing the conversation.',
  'landing.oneLinePromptLabel': 'What you write',
  'landing.oneLinePrompt':
    'I would like an app where anyone can publish their recipes and save their favourites.',
  'landing.oneLineResultLabel': 'What Evoliia built',
  'landing.oneLineFeature1': 'Several linked pages',
  'landing.oneLineFeature2': 'Member area',
  'landing.oneLineFeature3': 'Database',
  'landing.oneLineFeature4': 'Recipes published and browsable',
  'landing.oneLineFeature5': 'Readable on a phone',
  'landing.oneLineFeature6': 'Changed by conversation',
  'landing.oneLineEditTitle': 'Then you keep talking',
  'landing.oneLineEditBody':
    'Examples of requests the editor accepts. Each one changes the app and creates a new version you can roll back.',
  'landing.oneLineEdit1': 'Make the main button blue.',
  'landing.oneLineEdit2': 'Add a Premium plan at 9.90 € per month.',
  'landing.oneLineEdit3': 'Add an About page.',
  'landing.oneLineOpen': 'Open this app',

  'landing.noIdeaTitle': 'You do not even need an idea.',
  'landing.noIdeaBody':
    'That is the difference that matters. Evoliia starts by understanding your trade, your experience, the time you have, your budget and the goal you aim for. Ideas come after that.',
  'landing.profileLabel': 'Your profile',
  'landing.profileJob': 'Trade',
  'landing.profileJobValue': 'Baker',
  'landing.profileExperience': 'Experience',
  'landing.profileExperienceValue': '12 years',
  'landing.profileTime': 'Time available',
  'landing.profileTimeValue': '4 h per week',
  'landing.profileBudget': 'Budget',
  'landing.profileBudgetValue': '100 €',
  'landing.profileGoal': 'Goal',
  'landing.profileGoalValue': '500 € per month',
  'landing.suggestionLabel': 'Evoliia suggests',
  'landing.suggestionName': 'Cost and margin calculator for small bakeries',
  'landing.suggestionScore': 'Potential',
  'landing.suggestionScoreValue': '82 out of 100',
  'landing.suggestionDifficulty': 'Difficulty',
  'landing.suggestionDifficultyValue': 'Easy',
  'landing.suggestionPrice': 'Possible price',
  'landing.suggestionPriceValue': '14.90 € per month',
  'landing.suggestionTarget': 'Audience',
  'landing.suggestionTargetValue': 'Independent bakeries',
  'landing.suggestionCta': 'Study this idea',
  'landing.suggestionDisclaimer':
    'Illustrative simulation. The score and the amounts are calculations, never a forecast or a revenue guarantee.',

  'landing.projectsTitle': 'What could you launch?',
  'landing.projectsBody':
    'Every suggested idea is costed the same way: a price, and the number of customers it would take to reach your goal.',
  'landing.projectsGoal': 'For 1,000 € of monthly revenue',
  'landing.projectsCustomers': 'about {count} customers',
  'landing.projectsDifficulty': 'Difficulty',
  'landing.projectsNote':
    'Purely arithmetic examples, computed from the price shown. They are neither forecasts nor revenue guarantees.',
  'landing.projectsCta': 'See the ideas that match my profile',
  'landing.project1Name': 'Quote assistant for tradespeople',
  'landing.project2Name': 'Training tracker app',
  'landing.project3Name': 'Holiday rental management',
  'landing.project4Name': 'Study sheets for families',
  'landing.difficultyEasy': 'Easy',
  'landing.difficultyMedium': 'Medium',

  'landing.howTitle': 'How Evoliia works',
  'landing.howBody':
    'Six steps, in this order. Each one exists so the next is not wasted: nothing is built until the customer question is settled.',
  'landing.step1Title': 'Your goal',
  'landing.step1Body':
    'The amount you would like to reach, the time you have, your starting budget. Everything follows from this.',
  'landing.step2Title': 'Costed ideas',
  'landing.step2Body':
    'Several directions matched to your profile, each with a suggested price and the number of customers needed to reach your goal.',
  'landing.step3Title': 'Validation',
  'landing.step3Body':
    'Real demand, competition, legal obligations, hidden costs. The analysis is allowed to advise against an idea.',
  'landing.step4Title': 'The specification',
  'landing.step4Body':
    'What will be built, what is deliberately postponed, and what depends on an outside service. You read it before anything starts.',
  'landing.step5Title': 'The build',
  'landing.step5Body':
    'The app is generated, checked, and you watch it take shape. You change it by writing what you want different.',
  'landing.step6Title': 'Going live',
  'landing.step6Body':
    'An address to share, a sales page, and a view of what actually happens: visits, sign-ups, payments.',

  'landing.showcaseTitle': 'Built with Evoliia',
  'landing.showcaseBody':
    'Real apps, not mockups. Each one is published by the Evoliia engine and opens in your browser.',
  'landing.showcaseMobileLabel': 'The same app on a phone',
  'landing.showcaseNote':
    'These are web apps. On a phone they add themselves to the home screen straight from the browser: icon, name, full screen, no address bar. They do not go through the App Store or Google Play, where those stores decide alone and we promise nothing on their behalf.',

  'landing.compareTitle': 'More than an app builder',
  'landing.compareBody':
    'Generating code only answers part of the problem. You still need to know what to build, for whom, and at what price.',
  'landing.compareLeftTitle': 'An app builder',
  'landing.compareLeftIntro': 'You already need to know:',
  'landing.compareLeft1': 'what you want to build',
  'landing.compareLeft2': 'which features are needed',
  'landing.compareLeft3': 'how to sell it, and at what price',
  'landing.compareLeft4': 'how to find your first customers',
  'landing.compareRightTitle': 'Evoliia',
  'landing.compareRightIntro': 'We help you:',
  'landing.compareRight1': 'find an idea that fits your profile',
  'landing.compareRight2': 'check its potential before building',
  'landing.compareRight3': 'define what the first version will do',
  'landing.compareRight4': 'build the app',
  'landing.compareRight5': 'prepare how it earns money',
  'landing.compareRight6': 'prepare its launch',

  'landing.pricingTitle': 'What it costs',
  'landing.pricingBody':
    'You only pay when you build. Setting your goal, receiving ideas and having one analysed costs nothing.',
  'landing.pricingFree': 'Free',
  'landing.pricingPerMonth': 'per month',
  'landing.pricingCredits': '{count} credits per month',
  'landing.pricingProjectsOne': 'One app',
  'landing.pricingProjects': 'Up to {count} apps',
  'landing.pricingNoBuild': 'Stops before the build',
  'landing.pricingBuild': 'Build and publish',
  'landing.pricingDomain': 'Custom address',
  'landing.pricingExport': 'Code export',
  'landing.pricingMobile': 'Mobile preparation',
  'landing.pricingRecommended': 'Most chosen',
  'landing.pricingCtaFree': 'Start for free',
  'landing.pricingCtaPaid': 'Create my account',
  'landing.pricingPaymentNote':
    'Online payment is not active on this installation yet. Create your account for free: you will pick your plan the day it is, without losing any of your work.',
  'landing.pricingNote':
    'Credits cover the operations that call on artificial intelligence. A search for ideas uses about a dozen, building an app about twenty.',

  'landing.honestTitle': 'What we will never promise you',
  'landing.honestBody':
    'An honest tool beats an enthusiastic one. Here is what you will never read here.',
  'landing.honest1Title': 'No guaranteed income',
  'landing.honest1Body':
    'We will never tell you how much you will earn. We calculate how many customers would be needed, at what price. What you make of it depends on your market and your work.',
  'landing.honest2Title': 'No promises about app stores',
  'landing.honest2Body':
    'Nobody can guarantee that Apple or Google will accept an app. We tell you what they require, and what is left for you to do.',
  'landing.honest3Title': 'No hidden costs',
  'landing.honest3Body':
    'When an idea needs an outside account, an approval or a paid service, it is written down before the build, not discovered afterwards.',

  'landing.faqTitle': 'Frequently asked questions',
  'landing.faq1Q': 'Do I need to know how to code?',
  'landing.faq1A':
    'No. You describe what you want in plain words, Evoliia builds the app, and you change it by writing your requests. You never see code.',
  'landing.faq2Q': 'What exactly can I build?',
  'landing.faq2A':
    'Web apps: trade tools, sign-up or booking sites, catalogues, member areas, small SaaS products. They display on a computer as well as on a phone, where they can be installed on the home screen like any other app.',
  'landing.faq3Q': 'What if I have no idea at all?',
  'landing.faq3A':
    'That is the most common case, and it is the intended starting point. Evoliia starts from your goal and what you know how to do, then suggests costed ideas to compare.',
  'landing.faq4Q': 'Can I really sell my app?',
  'landing.faq4A':
    'Nothing stops you technically: you set a price and plans. Finding customers is still your work, and no income is guaranteed.',
  'landing.faq5Q': 'Will my app be on the App Store?',
  'landing.faq5A':
    'Not today, and your customers do not need it to install it. From the browser on their phone they add it to their home screen: it takes its icon, its name, and opens full screen. No developer account, no yearly fee, no review delay. Publishing to the mobile stores does depend on Apple and Google, who decide alone.',
  'landing.faq6Q': 'Who owns my data?',
  'landing.faq6A':
    'You do. Each app is isolated from the others, and your users data stays with your project.',

  'landing.finalTitle': 'Start with a question, not with an idea',
  'landing.finalBody':
    'A few minutes are enough to set your goal and receive your first costed directions.',
  'landing.finalCta': 'Start for free',
  'landing.footerTagline':
    'Evoliia helps people build extra income without knowing how to code.',
  'landing.footerLegal': 'Legal notice',
  'landing.footerTerms': 'Terms of use',
  'landing.footerPrivacy': 'Privacy',
  'landing.footerRights': 'All rights reserved.',

  'auth.registerTitle': 'Create your account',
  'auth.loginTitle': 'Sign in',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.name': 'Your first name',
  'auth.passwordHint': 'At least 10 characters, with a digit or a symbol.',
  'auth.noAccount': "Don't have an account yet?",
  'auth.hasAccount': 'Already have an account?',

  'dashboard.title': 'My apps',
  'dashboard.empty': "You don't have an app yet.",
  'dashboard.emptyBody': 'Start by describing what you would like to create.',
  'dashboard.create': 'Create an app',
  'dashboard.credits': 'Credits left',
  'dashboard.lastEdited': 'Edited',

  'status.DRAFT': 'Building',
  'status.TESTING': 'Testing',
  'status.READY': 'Ready to publish',
  'status.PUBLISHED': 'Published',

  'create.question': 'What would you like to create?',
  'create.describe': 'Describe your idea',
  'create.placeholder':
    'For example: an app that helps dog owners find walking routes near them.',
  'create.noIdea': "I don't have an idea yet",
  'create.submit': 'Analyse my idea',

  'progress.title': 'Your app',
  'progress.idea': 'Idea',
  'progress.design': 'Design',
  'progress.features': 'Features',
  'progress.tests': 'Tests',
  'progress.monetization': 'Monetisation',
  'progress.publication': 'Publication',

  'project.preview': 'Preview',
  'project.assistant': 'Edit with AI',
  'project.design': 'Design',
  'project.features': 'Features',
  'project.users': 'Users',
  'project.monetization': 'Monetisation',
  'project.tests': 'Tests',
  'project.publication': 'Publication',
  'project.settings': 'Settings',
  'project.versions': 'Versions',

  'editor.chatPlaceholder': 'Say what you want to change…',
  'editor.send': 'Send',
  'editor.thinking': 'The assistant is working…',
  'editor.devicePhone': 'Phone',
  'editor.deviceTablet': 'Tablet',
  'editor.deviceDesktop': 'Desktop',

  'versions.title': 'Version history',
  'versions.restore': 'Restore this version',
  'versions.restored': 'Version restored',

  'publish.title': 'Publish my app',
  'publish.action': 'Publish my app',
  'publish.published': 'Your app is online',
  'publish.readyPercent': 'Your app is {percent}% ready',

  'credits.insufficient':
    'You no longer have enough credits for this operation. Your credits renew every month.',
  'ai.disabled': 'The assistant is not configured on this installation. See the setup guide.',

  'landing.step7Title': 'The launch',
  'landing.step7Body':
    "Building an app does not make it known. Your marketing angles, your post ideas and your first week, prepared from what you have already described.",

  'landing.launchTitle': 'Once it is live, it has to be found',
  'landing.launchBody':
    "This is where most projects stop: the app exists, and nobody knows what to say about it. Evoliia prepares enough to start, without asking you to write everything again.",
  'landing.launchAnglesTitle': 'Your marketing angles',
  'landing.launchAnglesBody':
    "Several ways to present the same app: time saved, problem avoided, result obtained. Keep the ones that sound like you, drop the rest.",
  'landing.launchIdeasTitle': 'Seven post ideas',
  'landing.launchIdeasBody':
    "Each with its hook, what to show and say, and the photo or video to prepare. Enough for a first week without wondering what to publish.",
  'landing.launchWeekTitle': 'Your first week',
  'landing.launchWeekBody':
    "Seven dated, written posts with their call to action. Every text can be edited in place, then you approve what suits you.",
  'landing.launchSourceTitle': 'Nothing is asked twice',
  'landing.launchSourceBody':
    "The problem you solve, your audience, your value proposition, your price: all of it comes from what you already wrote along the way. No extra form.",
  'landing.launchLimitTitle': 'What we do not do',
  'landing.launchLimitBody':
    "Nothing is published, nothing is scheduled: social networks are not connected. The kit is there to be read, corrected and copied. No statistic is invented, and no customer review is written on your behalf.",
  'landing.launchSendTitle': 'Then you send it',
  'landing.launchSendBody':
    "Once the week is approved, one click drops it into your Postelya workspace, where you choose when each post goes out. Nothing leaves without your say-so. No statistic is invented, and no customer review is written on your behalf.",
  'landing.launchIncluded': 'Included from the Launch plan.',

  'landing.pricingLaunchKit': 'Marketing launch kit',
  'landing.pricingInstall': 'Installs on the home screen',
  'landing.pricingImages': '{size} of images of your own',
}
