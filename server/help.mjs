/**
 * How the CRM works, page by page (French). Used by the staff assistant to
 * answer "how do I…?" questions, with or without the Claude key.
 */
export const helpArticles = [
  {
    id: "client",
    page: "Students",
    title: "Ajouter un client",
    keywords:
      "ajouter client nouveau fiche creer contact eleve عميل جديد اضافة",
    body: "Menu « Clients et élèves » → bouton « Ajouter un client ». Indiquez au moins le nom et un téléphone ou un e-mail. Le CRM vous prévient s'il existe déjà (doublon).",
  },
  {
    id: "request",
    page: "Admissions",
    title: "Enregistrer une nouvelle demande",
    keywords:
      "demande prospect lead appel inscription nouvelle demande طلب تسجيل",
    body: "Menu « Demandes » → « Nouvelle demande ». Choisissez le client (ou créez-le), ce qu'il demande et la source (Instagram, téléphone…). Une tâche « premier contact » est créée pour le conseiller. Faites glisser la carte d'une étape à l'autre.",
  },
  {
    id: "appointment",
    page: "Calendar",
    title: "Prendre un rendez-vous",
    keywords:
      "rendez-vous rdv reserver agenda planning consultation creneau موعد حجز",
    body: "Menu « Agenda » → cliquez sur un créneau libre, ou bouton « Ajout rapide » → « Rendez-vous ». Choisissez le client, le spécialiste, l'heure et la salle. Le CRM signale un conflit de salle ou de spécialiste. Depuis la fiche client : « Prendre rendez-vous ».",
  },
  {
    id: "payment",
    page: "Payments",
    title: "Enregistrer un paiement",
    keywords:
      "paiement payer encaisser recu argent especes ccp versement دفع وصل",
    body: "Menu « Paiements » → « Enregistrer un paiement ». Choisissez le client et le montant dû (ou tapez un nouveau libellé), le moyen de paiement, puis imprimez le reçu. Un relevé CCP/banque peut être importé avec « Importer un relevé ».",
  },
  {
    id: "debts",
    page: "Payments",
    filter: "Who owes what",
    title: "Voir qui n'a pas payé",
    keywords: "dette impaye retard doit relance paiement en retard ديون متأخر",
    body: "Menu « Paiements » → onglet « Dettes » : la liste des clients en retard, avec le bouton WhatsApp pour un rappel poli.",
  },
  {
    id: "attendance",
    page: "Attendance",
    title: "Faire l'appel d'un groupe",
    keywords: "presence appel absent groupe seance cours حضور غياب",
    body: "Menu « Présences » → choisissez la séance → cochez Présent, Absent, En retard ou Excusé. Après deux absences, l'élève apparaît dans « À suivre ».",
  },
  {
    id: "messages",
    page: "Messages",
    title: "Répondre aux messages",
    keywords:
      "message whatsapp repondre conversation inbox client ecrit رسالة رد واتساب",
    body: "Menu « Messages » : toutes les conversations. Ouvrez un client, écrivez la réponse, choisissez « Nous avons répondu » ou « Le client a écrit ». Le bot peut proposer une réponse : vérifiez-la puis envoyez-la. Marquez la conversation « Résolu » quand c'est fini.",
  },
  {
    id: "call",
    page: "Messages",
    title: "Noter un appel",
    keywords: "appel telephone rappeler noter appel resultat مكالمة اتصال",
    body: "Dans la fiche client ou dans Messages : bouton « Appeler ». Choisissez le résultat (joint, pas de réponse, à rappeler). Une tâche « rappeler » est créée si besoin.",
  },
  {
    id: "scenario",
    page: "Settings",
    filter: "Scenarios",
    title: "Créer un scénario automatique",
    keywords:
      "scenario automatisation automatique rappel regle quand si faire سيناريو تلقائي",
    body: "Paramètres → « Scénarios » → « Nouveau scénario ». Choisissez Quand (ex. après un rendez-vous), Si (ex. service Psychologie) et Faire (tâche, WhatsApp, étiquette…). Bouton « Test » pour voir ce qui se passerait. Trois scénarios sont prêts en un clic.",
  },
  {
    id: "form",
    page: "Settings",
    filter: "Forms",
    title: "Créer un formulaire pour Instagram ou le site",
    keywords:
      "formulaire form google forms tally inscription lien site instagram استمارة",
    body: "Paramètres → « Formulaires » → « Nouveau formulaire ». Ajoutez les questions, puis « Copier le lien » pour Instagram ou « Code pour le site ». Chaque réponse crée le client et la demande.",
  },
  {
    id: "document",
    page: "Students",
    title: "Faire signer un contrat ou une attestation",
    keywords:
      "contrat document attestation certificat signer signature pdf عقد شهادة توقيع",
    body: "Ouvrez la fiche du client → bouton « Document ». Choisissez le modèle, vérifiez les informations, faites signer avec le doigt puis « Enregistrer dans les documents » (PDF). Les modèles se modifient dans Paramètres → « Modèles de documents ».",
  },
  {
    id: "campaign",
    page: "Campaigns",
    title: "Envoyer un message à un groupe de clients",
    keywords: "campagne envoi groupe masse promotion annonce segment حملة",
    body: "Menu « Campagnes » : choisissez qui reçoit (segment, service, niveau…), écrivez le message avec {name}, puis envoyez un par un sur WhatsApp ou automatiquement si Meta est connecté.",
  },
  {
    id: "team",
    page: "Settings",
    filter: "Team & permissions",
    title: "Ajouter un membre de l'équipe ou changer un mot de passe",
    keywords:
      "equipe employe membre compte mot de passe role acces desactiver فريق موظف كلمة السر",
    body: "Paramètres → « Équipe et accès » : ajoutez un membre, choisissez son rôle (Directeur, Administrateur, Secrétaire, Enseignant), changez son mot de passe ou désactivez son compte. Les droits fins sont dans « Filiales et accès ».",
  },
  {
    id: "reports",
    page: "Reports",
    title: "Voir les chiffres et les rapports",
    keywords:
      "rapport chiffre statistique analyse revenu recette combien graphique تقرير احصائيات",
    body: "Menu « Rapports » : rapport de direction, créateur de rapports (quoi compter × par quoi × période, export Excel/PDF), retour des clients et prévisions. « Mon tableau de bord » se compose de vos propres blocs.",
  },
  {
    id: "predictions",
    page: "Predictions",
    title: "Prévisions : absences, départs, demandes",
    keywords:
      "prevision prediction risque absence depart churn score probabilite تنبؤ توقع",
    body: "Menu « Prévisions » : le risque d'absence de chaque rendez-vous, les clients qui risquent de partir, les demandes les plus prometteuses, les meilleurs horaires et la charge des 4 prochaines semaines. Tout est calculé dans le CRM, gratuitement.",
  },
  {
    id: "import",
    page: "Settings",
    filter: "Data & import",
    title: "Importer un fichier Excel",
    keywords: "import excel fichier sauvegarde export donnees backup استيراد",
    body: "Paramètres → « Données et import » : importez votre fichier Excel, téléchargez une sauvegarde ou exportez vos données.",
  },
  {
    id: "bot",
    page: "Settings",
    filter: "Assistant & bot",
    title: "Régler le bot pour les clients",
    keywords:
      "bot chatbot reponse automatique base de connaissances faq site widget بوت",
    body: "Paramètres → « Assistant et bot » : écrivez les réponses (prix, adresse, horaires), choisissez le mode (brouillons ou envoi automatique) et copiez le code du chat pour votre site.",
  },
];
