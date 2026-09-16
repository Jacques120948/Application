/*
 * Images créées par l'IA sur le compte d'Evoliia.
 *
 * Jusqu'ici, générer une image exigeait que le créateur connecte sa propre clé OpenAI ou
 * Google. C'était le bon choix tant qu'Evoliia n'avait pas de système de crédits : personne
 * ne pouvait facturer une dépense qui n'était mesurée nulle part. Ce n'est plus le cas.
 *
 * Deux bornes indépendantes encadrent la dépense, et la première atteinte arrête.
 *
 * **Un quota mensuel par offre**, à zéro par défaut, comme les alertes et le Radar. La
 * fonction s'ouvre offre par offre depuis le back-office, jamais toute seule : c'est de
 * l'argent qui sort du compte d'Evoliia, pas un réglage d'affichage.
 *
 * **Les crédits du créateur**, débités au coût réel. Une image coûte environ huit crédits
 * quand une application entière en coûte vingt et un : sans les deux bornes à la fois, un
 * créateur viderait son mois en douze images sans l'avoir vu venir, et ne pourrait plus
 * modifier son application.
 *
 * Le créateur qui connecte sa propre clé garde la voie d'avant, hors quota et hors crédits :
 * elle ne coûte rien à Evoliia et reste l'option de celui qui veut en faire beaucoup.
 */

ALTER TABLE "Plan" ADD COLUMN "imagesPerMonth" INTEGER NOT NULL DEFAULT 0;
