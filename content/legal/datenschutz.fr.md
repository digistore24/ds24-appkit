<!-- ds24-appkit:placeholder -->
Cette page n'est pas encore remplie.

Une politique de confidentialité au sens de l'**art. 13 du RGPD** est
obligatoire dès que cette application traite des données personnelles — ce
qu'elle fait dès le premier compte.

**Ne la rédige pas à partir d'un modèle générique.** Une politique générique
décrit une autre application que la tienne et laisse de côté précisément ce qui
se passe ici : que les adresses IP sont comptées en mémoire pendant quinze
minutes, que les webhooks bruts de Digistore24 sont conservés 60 jours, et
quelle entreprise d'IA reçoit ce que tes clients écrivent dans le chat.

La base existe déjà : **docs/data-protection.md** est l'inventaire, et il a été
lu dans le code plutôt que de mémoire. Le skill **compliance-check** rédige la
politique à partir de cet inventaire et ne te demande que ce qui ne figure pas
sur le disque.

Ce que la skill écrit est un **projet à soumettre à un conseil juridique** ;
il est signalé comme tel sur la page jusqu'à ce que tu retires la mention
après la relecture — ce n'est pas un conseil juridique.

**node run.mjs legal-check** t'indique à tout moment quelles pages légales portent
encore ce texte.
