/**
 * Environnement des tests.
 *
 * Les tests d'intégration tournent sur une vraie base PostgreSQL, avec le rôle applicatif
 * soumis au Row Level Security : c'est la seule façon de vérifier réellement l'isolation.
 */
process.env.DATABASE_URL ??= 'postgresql://appforge_app:appforge_app_dev@127.0.0.1:5432/appforge_test'
process.env.DIRECT_DATABASE_URL ??= 'postgresql://appforge:appforge_dev@127.0.0.1:5432/appforge_test'
process.env.SESSION_SECRET ??= 'secret-de-test-suffisamment-long-0123456789'
process.env.ENCRYPTION_KEY ??= 'cle-de-test-suffisamment-longue-0123456789'
process.env.APP_URL ??= 'http://localhost:3000'
// Aucun appel réseau vers le modèle pendant les tests.
delete process.env.ANTHROPIC_API_KEY
