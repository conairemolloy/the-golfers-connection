import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "./auth-schema";

// --- enums ---------------------------------------------------------------

export const profileStatus = pgEnum("profile_status", [
  "applicant",
  "member",
  "lapsed",
  "removed",
]);

export const consentStatus = pgEnum("consent_status", [
  "none",
  "informed",
  "consented",
  "declined",
]);

export const membershipVerificationState = pgEnum(
  "membership_verification_state",
  ["declared", "documented", "club_confirmed"],
);

export const verificationKind = pgEnum("verification_kind", [
  "identity",
  "club",
  "handicap",
  "cover",
]);

export const verificationStatus = pgEnum("verification_status", [
  "pending",
  "verified",
  "failed",
  "expired",
]);

export const applicationState = pgEnum("application_state", [
  "draft",
  "submitted",
  "awaiting_endorsements",
  "awaiting_club",
  "with_committee",
  "approved",
  "declined",
]);

export const endorsementRole = pgEnum("endorsement_role", [
  "proposer",
  "seconder",
]);

export const endorsementState = pgEnum("endorsement_state", [
  "requested",
  "given",
  "refused",
]);

export const requestState = pgEnum("request_state", [
  "open",
  "filled",
  "withdrawn",
  "expired",
]);

export const offerState = pgEnum("offer_state", [
  "offered",
  "accepted",
  "scheduled",
  "played",
  "confirmed",
  "settled",
  "withdrawn",
  "declined",
  "expired",
  "cancelled",
]);

export const roundParticipantRole = pgEnum("round_participant_role", [
  "host",
  "guest",
]);

export const ledgerDirection = pgEnum("ledger_direction", ["credit", "debit"]);

export const threadKind = pgEnum("thread_kind", ["round", "trip", "fixture"]);

export const clubEventKind = pgEnum("club_event_kind", [
  "maintenance",
  "closure",
  "competition",
  "news",
]);

export const clubEventSeverity = pgEnum("club_event_severity", [
  "info",
  "warning",
]);

// --- clubs -----------------------------------------------------------------

export const clubs = pgTable(
  "clubs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    region: text("region").notNull(),
    country: text("country").notNull(),
    tier: integer("tier").notNull(),
    accessDifficulty: integer("access_difficulty").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    timezone: text("timezone").notNull(),
    guestFeePence: integer("guest_fee_pence"),
    consentStatus: consentStatus("consent_status").notNull().default("none"),
    secretaryEmail: text("secretary_email"),
  },
  (table) => [
    check("clubs_tier_check", sql`${table.tier} between 1 and 4`),
    check(
      "clubs_access_difficulty_check",
      sql`${table.accessDifficulty} between 1 and 4`,
    ),
  ],
);

export const clubCourses = pgTable(
  "club_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    name: text("name").notNull(),
    holes: integer("holes").notNull(),
    par: integer("par").notNull(),
    // Bearings in degrees 0-359, for the wind line.
    outBearing: integer("out_bearing"),
    inBearing: integer("in_bearing"),
  },
  (table) => [
    index("club_courses_club_id_idx").on(table.clubId),
    check(
      "club_courses_out_bearing_check",
      sql`${table.outBearing} is null or ${table.outBearing} between 0 and 359`,
    ),
    check(
      "club_courses_in_bearing_check",
      sql`${table.inBearing} is null or ${table.inBearing} between 0 and 359`,
    ),
  ],
);

export const clubContent = pgTable(
  "club_content",
  {
    clubId: uuid("club_id")
      .primaryKey()
      .references(() => clubs.id),
    dressOnCourse: text("dress_on_course"),
    dressClubhouse: text("dress_clubhouse"),
    phones: text("phones"),
    trolleys: text("trolleys"),
    caddies: text("caddies"),
    caddieFeeNote: text("caddie_fee_note"),
    afterGolf: text("after_golf"),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => profiles.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("club_content_updated_by_idx").on(table.updatedBy)],
);

export const clubEvents = pgTable(
  "club_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    kind: clubEventKind("kind").notNull(),
    dateFrom: date("date_from").notNull(),
    dateTo: date("date_to"),
    body: text("body").notNull(),
    severity: clubEventSeverity("severity").notNull().default("info"),
  },
  (table) => [index("club_events_club_id_idx").on(table.clubId)],
);

// --- people ------------------------------------------------------------

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id),
    displayName: text("display_name").notNull(),
    initials: text("initials").notNull(),
    discretionMode: boolean("discretion_mode").notNull().default(false),
    homeClubId: uuid("home_club_id").references(() => clubs.id),
    status: profileStatus("status").notNull().default("applicant"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("profiles_home_club_id_idx").on(table.homeClubId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    memberSince: integer("member_since"),
    memberNumber: text("member_number"),
    verificationState: membershipVerificationState("verification_state")
      .notNull()
      .default("declared"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    recheckDue: timestamp("recheck_due", { withTimezone: true }),
  },
  (table) => [
    unique("memberships_user_club_unique").on(table.userId, table.clubId),
    index("memberships_club_id_idx").on(table.clubId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    kind: verificationKind("kind").notNull(),
    status: verificationStatus("status").notNull().default("pending"),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("verifications_user_id_idx").on(table.userId)],
);

export const handicaps = pgTable("handicaps", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id),
  handicapIndex: numeric("index", { precision: 4, scale: 1 }).notNull(),
  source: text("source").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  locked: boolean("locked").notNull().default(true),
});

// --- membership pipeline -------------------------------------------------

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => profiles.id),
    issuedToEmail: text("issued_to_email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedBy: uuid("redeemed_by").references(() => profiles.id),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  },
  (table) => [
    index("invitations_issued_by_idx").on(table.issuedBy),
    index("invitations_redeemed_by_idx").on(table.redeemedBy),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    state: applicationState("state").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => profiles.id),
    declineReason: text("decline_reason"),
  },
  (table) => [
    index("applications_user_id_idx").on(table.userId),
    index("applications_club_id_idx").on(table.clubId),
    index("applications_decided_by_idx").on(table.decidedBy),
  ],
);

export const endorsements = pgTable(
  "endorsements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    endorserId: uuid("endorser_id")
      .notNull()
      .references(() => profiles.id),
    role: endorsementRole("role").notNull(),
    state: endorsementState("state").notNull().default("requested"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    unique("endorsements_application_role_unique").on(
      table.applicationId,
      table.role,
    ),
    index("endorsements_endorser_id_idx").on(table.endorserId),
  ],
);

// --- requests & offers ---------------------------------------------------

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    region: text("region").notNull(),
    dateFrom: date("date_from").notNull(),
    dateTo: date("date_to").notNull(),
    partySize: integer("party_size").notNull(),
    handicaps: text("handicaps"),
    flexibility: text("flexibility"),
    note: text("note"),
    state: requestState("state").notNull().default("open"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("requests_user_id_idx").on(table.userId),
    index("requests_state_date_from_idx").on(table.state, table.dateFrom),
  ],
);

export const requestTargets = pgTable(
  "request_targets",
  {
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
  },
  (table) => [
    primaryKey({ columns: [table.requestId, table.clubId] }),
    index("request_targets_club_id_idx").on(table.clubId),
  ],
);

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    hostId: uuid("host_id")
      .notNull()
      .references(() => profiles.id),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => clubCourses.id),
    // Local tee time with no offset — tee_timezone carries the offset.
    teeAtLocal: timestamp("tee_at_local").notNull(),
    teeTimezone: text("tee_timezone").notNull(),
    state: offerState("state").notNull().default("offered"),
    message: text("message"),
  },
  (table) => [
    index("offers_host_id_idx").on(table.hostId),
    index("offers_club_id_idx").on(table.clubId),
    index("offers_course_id_idx").on(table.courseId),
    index("offers_request_id_state_idx").on(table.requestId, table.state),
  ],
);

// --- rounds ----------------------------------------------------------------

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id)
      .unique(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => clubCourses.id),
    playedOn: date("played_on").notNull(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => profiles.id),
    hostConfirmedAt: timestamp("host_confirmed_at", { withTimezone: true }),
    guestConfirmedAt: timestamp("guest_confirmed_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    index("rounds_course_id_idx").on(table.courseId),
    index("rounds_host_id_idx").on(table.hostId),
  ],
);

export const roundParticipants = pgTable(
  "round_participants",
  {
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    role: roundParticipantRole("role").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.userId] }),
    index("round_participants_user_id_idx").on(table.userId),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    direction: ledgerDirection("direction").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
  },
  (table) => [
    index("ledger_entries_user_id_idx").on(table.userId),
    unique("ledger_entries_round_user_direction_unique").on(
      table.roundId,
      table.userId,
      table.direction,
    ),
  ],
);

// --- messaging -------------------------------------------------------------

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: threadKind("kind").notNull(),
    // Polymorphic: points at rounds.id, a trip's id, or a fixture's id
    // depending on kind. No formal FK — enforced by application code that
    // creates threads, per CLAUDE.md domain rules.
    subjectId: uuid("subject_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("threads_subject_id_idx").on(table.subjectId)],
);

export const threadMembers = pgTable(
  "thread_members",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    muted: boolean("muted").notNull().default(false),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.userId] }),
    index("thread_members_user_id_idx").on(table.userId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => profiles.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (table) => [
    index("messages_thread_id_idx").on(table.threadId),
    index("messages_sender_id_idx").on(table.senderId),
  ],
);

// --- trust & safety ----------------------------------------------------

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id),
    fromUser: uuid("from_user")
      .notNull()
      .references(() => profiles.id),
    toUser: uuid("to_user")
      .notNull()
      .references(() => profiles.id),
    wouldAgain: boolean("would_again").notNull(),
    marks: text("marks")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    unique("feedback_round_from_user_unique").on(table.roundId, table.fromUser),
    index("feedback_from_user_idx").on(table.fromUser),
    index("feedback_to_user_idx").on(table.toUser),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").references(() => rounds.id),
    fromUser: uuid("from_user")
      .notNull()
      .references(() => profiles.id),
    aboutUser: uuid("about_user")
      .notNull()
      .references(() => profiles.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    handledBy: uuid("handled_by").references(() => profiles.id),
    handledAt: timestamp("handled_at", { withTimezone: true }),
  },
  (table) => [
    index("reports_round_id_idx").on(table.roundId),
    index("reports_from_user_idx").on(table.fromUser),
    index("reports_about_user_idx").on(table.aboutUser),
    index("reports_handled_by_idx").on(table.handledBy),
  ],
);

// --- platform ------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => profiles.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("audit_log_actor_id_idx").on(table.actorId)],
);

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  scope: text("scope"),
});
