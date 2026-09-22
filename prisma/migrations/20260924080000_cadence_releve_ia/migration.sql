-- La cadence du relevé dans les assistants, choisie par la personne.
--
-- Elle était fixée à sept jours pour tout le monde. C'est la dépense la plus lourde du
-- produit — une question posée à trois assistants coûte trois crédits, et un site qui suit
-- vingt questions dépense soixante crédits par semaine, soit deux cent soixante par mois —
-- alors que ce qu'un assistant répond bouge au mois, pas à la semaine.
--
-- Sept jours reste la valeur par défaut : personne ne voit son rythme changer sans l'avoir
-- demandé. Mais qui suit beaucoup de questions peut désormais passer à la quinzaine ou au
-- mois et diviser cette dépense par deux ou par quatre, sans rien perdre de la tendance.
--
-- En jours plutôt qu'en mots-clés : la règle qui décide s'écrit alors telle quelle, et
-- ajouter une cadence ne demandera pas de traduire un libellé en durée quelque part.
ALTER TABLE "SiteAutomatisation"
  ADD COLUMN "assistantsJours" INTEGER NOT NULL DEFAULT 7;
