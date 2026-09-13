/**
 * Hand-maintained mirror of `supabase/migrations`.
 *
 * Once a Supabase project exists, replace this file wholesale with
 * `npm run db:types` (`supabase gen types typescript`). Until then it is the
 * single source of truth for the client's generic parameter, and it must be
 * updated in the same commit as any migration that changes a table.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type PlatformRole = 'admin';
export type OperatorType = 'intercity' | 'incity';
export type OperatorStatus = 'pending' | 'active' | 'suspended';
export type OperatorMemberRole = 'owner' | 'staff' | 'driver';
export type SubscriptionPlan = 'weekly' | 'monthly';
export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled';
export type PricingMode = 'matrix' | 'additive';
export type DepartureStatus = 'scheduled' | 'cancelled' | 'completed';
export type PaymentMethod = 'cash' | 'etransfer';
export type RatingDirection = 'passenger_to_operator' | 'operator_to_passenger';

/**
 * The kinds that can be filed as an in-app notification. Deliberately excludes
 * login_code and password_reset — see 20260830000018_notifications.sql.
 */
export type NotificationKind =
  | 'seat_requested'
  | 'booking_approved'
  | 'booking_declined'
  | 'booking_cancelled'
  | 'departure_tomorrow'
  | 'payment_reminder'
  | 'incity_requested'
  | 'incity_approved'
  | 'incity_declined'
  | 'report_filed'
  | 'report_resolved'
  | 'feedback_filed';

export type BookingStatus =
  | 'held'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'cancelled_by_passenger'
  | 'cancelled_by_operator'
  | 'completed'
  | 'no_show'
  | 'settled';

export type RedFlagReason =
  | 'no_show'
  | 'did_not_pay'
  | 'haggled'
  | 'too_loud'
  | 'messy'
  | 'smelly'
  | 'other';

export type IncityBookingStatus = 'held' | 'approved' | 'declined' | 'cancelled' | 'completed';

export type ReportCategory =
  | 'driving'
  | 'lateness'
  | 'vehicle'
  | 'conduct'
  | 'overcharged'
  | 'safety'
  | 'other';
export type ReportStatus = 'open' | 'resolved';
export type FeedbackKind = 'idea' | 'problem' | 'praise' | 'other';

/**
 * Foreign keys, so an embedded select (`operator:operators(name)`) resolves to
 * the right shape. Generated from the migration rather than typed by hand.
 */
type Relationships = {
  profiles: [];
  auth_recovery_requests: [];
  subscription_payments: [
    {
      foreignKeyName: 'subscription_payments_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
  ];
  feedback: [
    {
      foreignKeyName: 'feedback_user_id_fkey';
      columns: ['user_id'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
  ];
  reports: [
    {
      foreignKeyName: 'reports_booking_id_fkey';
      columns: ['booking_id'];
      isOneToOne: false;
      referencedRelation: 'bookings';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'reports_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'reports_reporter_id_fkey';
      columns: ['reporter_id'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
  ];
  operator_invites: [
    {
      foreignKeyName: 'operator_invites_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'operator_invites_invited_by_fkey';
      columns: ['invited_by'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
  ];
  notifications: [
    {
      foreignKeyName: 'notifications_user_id_fkey';
      columns: ['user_id'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'notifications_booking_id_fkey';
      columns: ['booking_id'];
      isOneToOne: false;
      referencedRelation: 'bookings';
      referencedColumns: ['id'];
    },
  ];
  operators: [
    {
      foreignKeyName: 'operators_created_by_fkey';
      columns: ['created_by'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
  ];
  operator_members: [
    {
      foreignKeyName: 'operator_members_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'operator_members_user_id_fkey';
      columns: ['user_id'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
  ];
  subscriptions: [
    {
      foreignKeyName: 'subscriptions_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
  ];
  cities: [];
  stops: [
    {
      foreignKeyName: 'stops_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'stops_city_id_fkey';
      columns: ['city_id'];
      isOneToOne: false;
      referencedRelation: 'cities';
      referencedColumns: ['id'];
    },
  ];
  routes: [
    {
      foreignKeyName: 'routes_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
  ];
  route_stops: [
    {
      foreignKeyName: 'route_stops_route_id_fkey';
      columns: ['route_id'];
      isOneToOne: false;
      referencedRelation: 'routes';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'route_stops_stop_id_fkey';
      columns: ['stop_id'];
      isOneToOne: false;
      referencedRelation: 'stops';
      referencedColumns: ['id'];
    },
  ];
  fares: [
    {
      foreignKeyName: 'fares_route_id_fkey';
      columns: ['route_id'];
      isOneToOne: false;
      referencedRelation: 'routes';
      referencedColumns: ['id'];
    },
  ];
  fare_changes: [
    {
      foreignKeyName: 'fare_changes_route_id_fkey';
      columns: ['route_id'];
      isOneToOne: false;
      referencedRelation: 'routes';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'fare_changes_changed_by_fkey';
      columns: ['changed_by'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
  ];
  schedules: [
    {
      foreignKeyName: 'schedules_route_id_fkey';
      columns: ['route_id'];
      isOneToOne: false;
      referencedRelation: 'routes';
      referencedColumns: ['id'];
    },
  ];
  departures: [
    {
      foreignKeyName: 'departures_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'departures_route_id_fkey';
      columns: ['route_id'];
      isOneToOne: false;
      referencedRelation: 'routes';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'departures_schedule_id_fkey';
      columns: ['schedule_id'];
      isOneToOne: false;
      referencedRelation: 'schedules';
      referencedColumns: ['id'];
    },
  ];
  vehicles: [
    {
      foreignKeyName: 'vehicles_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
  ];
  departure_vehicles: [
    {
      foreignKeyName: 'departure_vehicles_departure_id_fkey';
      columns: ['departure_id'];
      isOneToOne: false;
      referencedRelation: 'departures';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'departure_vehicles_vehicle_id_fkey';
      columns: ['vehicle_id'];
      isOneToOne: false;
      referencedRelation: 'vehicles';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'departure_vehicles_driver_id_fkey';
      columns: ['driver_id'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
  ];
  bookings: [
    {
      foreignKeyName: 'bookings_departure_id_fkey';
      columns: ['departure_id'];
      isOneToOne: false;
      referencedRelation: 'departures';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'bookings_passenger_id_fkey';
      columns: ['passenger_id'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'bookings_from_stop_id_fkey';
      columns: ['from_stop_id'];
      isOneToOne: false;
      referencedRelation: 'stops';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'bookings_to_stop_id_fkey';
      columns: ['to_stop_id'];
      isOneToOne: false;
      referencedRelation: 'stops';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'bookings_assigned_vehicle_id_fkey';
      columns: ['assigned_vehicle_id'];
      isOneToOne: false;
      referencedRelation: 'vehicles';
      referencedColumns: ['id'];
    },
  ];
  ratings: [
    {
      foreignKeyName: 'ratings_booking_id_fkey';
      columns: ['booking_id'];
      isOneToOne: false;
      referencedRelation: 'bookings';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'ratings_rater_id_fkey';
      columns: ['rater_id'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'ratings_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'ratings_passenger_id_fkey';
      columns: ['passenger_id'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
  ];
  red_flags: [
    {
      foreignKeyName: 'red_flags_booking_id_fkey';
      columns: ['booking_id'];
      isOneToOne: false;
      referencedRelation: 'bookings';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'red_flags_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'red_flags_passenger_id_fkey';
      columns: ['passenger_id'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'red_flags_created_by_fkey';
      columns: ['created_by'];
      isOneToOne: false;
      referencedRelation: 'profiles';
      referencedColumns: ['id'];
    },
  ];
  incity_zones: [
    {
      foreignKeyName: 'incity_zones_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
  ];
  incity_bookings: [
    {
      foreignKeyName: 'incity_bookings_booking_id_fkey';
      columns: ['booking_id'];
      isOneToOne: false;
      referencedRelation: 'bookings';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'incity_bookings_operator_id_fkey';
      columns: ['operator_id'];
      isOneToOne: false;
      referencedRelation: 'operators';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'incity_bookings_pickup_stop_id_fkey';
      columns: ['pickup_stop_id'];
      isOneToOne: false;
      referencedRelation: 'stops';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'incity_bookings_zone_id_fkey';
      columns: ['zone_id'];
      isOneToOne: false;
      referencedRelation: 'incity_zones';
      referencedColumns: ['id'];
    },
  ];
};

/** Row shape plus the Insert/Update variants Supabase generates. */
type Table<
  Name extends keyof Relationships,
  Row extends Record<string, unknown>,
  Optional extends keyof Row,
  Generated extends keyof Row = never,
> = {
  Row: Row;
  Insert: Omit<Row, Optional | Generated> & Partial<Pick<Row, Optional | Generated>>;
  Update: Partial<Omit<Row, Generated>>;
  Relationships: Relationships[Name];
};

type Timestamps = { created_at: string; updated_at: string };

export interface Database {
  public: {
    Tables: {
      operator_invites: Table<
        'operator_invites',
        {
          id: string;
          operator_id: string;
          email: string;
          role: OperatorMemberRole;
          invited_by: string | null;
          created_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
        },
        'invited_by' | 'accepted_at' | 'accepted_by',
        'id' | 'created_at'
      >;
      subscription_payments: Table<
        'subscription_payments',
        {
          id: string;
          operator_id: string;
          amount_cents: number;
          paid_on: string;
          covers_until: string | null;
          note: string | null;
          recorded_by: string | null;
          created_at: string;
        },
        'covers_until' | 'note' | 'recorded_by',
        'id' | 'created_at'
      >;
      reports: Table<
        'reports',
        {
          id: string;
          booking_id: string;
          operator_id: string;
          reporter_id: string;
          category: ReportCategory;
          note: string;
          status: ReportStatus;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          created_at: string;
        },
        'status' | 'resolution' | 'resolved_at' | 'resolved_by',
        'id' | 'created_at'
      >;
      feedback: Table<
        'feedback',
        {
          id: string;
          user_id: string;
          kind: FeedbackKind;
          message: string;
          created_at: string;
        },
        never,
        'id' | 'created_at'
      >;
      notifications: Table<
        'notifications',
        {
          id: string;
          user_id: string;
          kind: NotificationKind;
          subject: string;
          body: string;
          link: string | null;
          booking_id: string | null;
          read_at: string | null;
          created_at: string;
        },
        'link' | 'booking_id' | 'read_at',
        'id' | 'created_at'
      >;
      auth_recovery_requests: Table<
        'auth_recovery_requests',
        { email_hash: string; requested_at: string },
        'requested_at'
      >;
      profiles: Table<
        'profiles',
        {
          id: string;
          full_name: string | null;
          phone: string | null;
          gender: string | null;
          photo_url: string | null;
          accommodation_notes: string | null;
          platform_role: PlatformRole | null;
          passenger_enabled: boolean;
          drives_enabled: boolean;
        } & Timestamps,
        | 'full_name'
        | 'phone'
        | 'gender'
        | 'photo_url'
        | 'accommodation_notes'
        | 'platform_role'
        | 'passenger_enabled'
        | 'drives_enabled',
        'created_at' | 'updated_at'
      >;
      operators: Table<
        'operators',
        {
          id: string;
          name: string;
          type: OperatorType;
          bio: string | null;
          public_phone: string | null;
          status: OperatorStatus;
          created_by: string | null;
          free_luggage_per_seat: number;
          extra_luggage_cents: number;
          airport_fee_cents: number;
        } & Timestamps,
        | 'type'
        | 'bio'
        | 'public_phone'
        | 'status'
        | 'created_by'
        | 'free_luggage_per_seat'
        | 'extra_luggage_cents'
        | 'airport_fee_cents',
        'id' | 'created_at' | 'updated_at'
      >;
      operator_members: Table<
        'operator_members',
        {
          id: string;
          operator_id: string;
          user_id: string;
          role: OperatorMemberRole;
          created_at: string;
        },
        never,
        'id' | 'created_at'
      >;
      subscriptions: Table<
        'subscriptions',
        {
          id: string;
          operator_id: string;
          plan: SubscriptionPlan;
          status: SubscriptionStatus;
          amount_cents: number;
          current_period_end: string | null;
        } & Timestamps,
        'status' | 'amount_cents' | 'current_period_end',
        'id' | 'created_at' | 'updated_at'
      >;
      cities: Table<
        'cities',
        {
          id: string;
          name: string;
          province: string;
          is_active: boolean;
          created_at: string;
        },
        'province' | 'is_active',
        'id' | 'created_at'
      >;
      stops: Table<
        'stops',
        {
          id: string;
          operator_id: string;
          city_id: string;
          label: string;
          description: string | null;
          is_active: boolean;
          is_airport: boolean;
        } & Timestamps,
        'description' | 'is_active' | 'is_airport',
        'id' | 'created_at' | 'updated_at'
      >;
      routes: Table<
        'routes',
        {
          id: string;
          operator_id: string;
          name: string;
          pricing_mode: PricingMode;
          is_active: boolean;
        } & Timestamps,
        'pricing_mode' | 'is_active',
        'id' | 'created_at' | 'updated_at'
      >;
      route_stops: Table<
        'route_stops',
        { id: string; route_id: string; stop_id: string; seq: number },
        never,
        'id'
      >;
      fares: Table<
        'fares',
        {
          id: string;
          route_id: string;
          from_seq: number;
          to_seq: number;
          price_cents: number;
        } & Timestamps,
        never,
        'id' | 'created_at' | 'updated_at'
      >;
      fare_changes: Table<
        'fare_changes',
        {
          id: string;
          route_id: string;
          from_seq: number;
          to_seq: number;
          old_price_cents: number | null;
          new_price_cents: number;
          reason: string;
          changed_by: string | null;
          created_at: string;
        },
        'old_price_cents' | 'changed_by',
        'id' | 'created_at'
      >;
      schedules: Table<
        'schedules',
        {
          id: string;
          route_id: string;
          departure_time: string;
          days_of_week: number[];
          max_seats: number;
          active_from: string;
          active_to: string | null;
          is_active: boolean;
        } & Timestamps,
        'active_to' | 'is_active',
        'id' | 'created_at' | 'updated_at'
      >;
      departures: Table<
        'departures',
        {
          id: string;
          operator_id: string;
          route_id: string;
          schedule_id: string | null;
          service_date: string;
          departure_time: string;
          max_seats: number;
          status: DepartureStatus;
        } & Timestamps,
        'schedule_id' | 'status',
        'id' | 'created_at' | 'updated_at'
      >;
      vehicles: Table<
        'vehicles',
        {
          id: string;
          operator_id: string;
          label: string;
          seat_count: number;
          is_active: boolean;
        } & Timestamps,
        'is_active',
        'id' | 'created_at' | 'updated_at'
      >;
      departure_vehicles: Table<
        'departure_vehicles',
        {
          id: string;
          departure_id: string;
          vehicle_id: string;
          driver_id: string | null;
          created_at: string;
        },
        'driver_id',
        'id' | 'created_at'
      >;
      bookings: Table<
        'bookings',
        {
          id: string;
          departure_id: string;
          passenger_id: string;
          from_stop_id: string;
          to_stop_id: string;
          from_seq: number;
          to_seq: number;
          seats: number;
          status: BookingStatus;
          hold_expires_at: string | null;
          luggage_count: number;
          base_cents: number;
          luggage_cents: number;
          airport_cents: number;
          total_cents: number;
          passenger_note: string | null;
          assigned_vehicle_id: string | null;
          payment_method: PaymentMethod | null;
          passenger_confirmed_at: string | null;
          driver_confirmed_at: string | null;
          approved_at: string | null;
          cancelled_at: string | null;
        } & Timestamps,
        | 'seats'
        | 'status'
        | 'hold_expires_at'
        | 'luggage_count'
        | 'luggage_cents'
        | 'airport_cents'
        | 'passenger_note'
        | 'assigned_vehicle_id'
        | 'payment_method'
        | 'passenger_confirmed_at'
        | 'driver_confirmed_at'
        | 'approved_at'
        | 'cancelled_at',
        'id' | 'created_at' | 'updated_at'
      >;
      ratings: Table<
        'ratings',
        {
          id: string;
          booking_id: string;
          direction: RatingDirection;
          rater_id: string;
          operator_id: string;
          passenger_id: string;
          score: number;
          comment: string | null;
          created_at: string;
        },
        'comment',
        'id' | 'created_at'
      >;
      red_flags: Table<
        'red_flags',
        {
          id: string;
          booking_id: string;
          operator_id: string;
          passenger_id: string;
          reason: RedFlagReason;
          note: string | null;
          created_by: string | null;
          created_at: string;
        },
        'note' | 'created_by',
        'id' | 'created_at'
      >;
      incity_zones: Table<
        'incity_zones',
        {
          id: string;
          operator_id: string;
          name: string;
          flat_price_cents: number;
          is_active: boolean;
        } & Timestamps,
        'is_active',
        'id' | 'created_at' | 'updated_at'
      >;
      incity_bookings: Table<
        'incity_bookings',
        {
          id: string;
          booking_id: string;
          operator_id: string;
          pickup_stop_id: string;
          zone_id: string;
          destination_address: string;
          price_cents: number;
          status: IncityBookingStatus;
        } & Timestamps,
        'status',
        'id' | 'created_at' | 'updated_at'
      >;
    };
    Views: Record<string, never>;
    Functions: {
      save_route: {
        Args: {
          p_operator_id: string;
          p_route_id: string | null;
          p_name: string;
          p_pricing_mode: PricingMode;
          p_stop_ids: string[];
        };
        Returns: string;
      };
      set_fare: {
        Args: {
          p_route_id: string;
          p_from_seq: number;
          p_to_seq: number;
          p_price_cents: number;
          p_reason: string;
        };
        Returns: undefined;
      };
      generate_departures: {
        Args: { p_operator_id?: string | null; p_days?: number };
        Returns: number;
      };
      quote_booking: {
        Args: {
          p_departure_id: string;
          p_from_stop_id: string;
          p_to_stop_id: string;
          p_seats: number;
          p_luggage_count: number;
        };
        Returns: {
          base_cents: number;
          luggage_cents: number;
          airport_cents: number;
          total_cents: number;
        }[];
      };
      departure_leg_loads: {
        Args: { p_departure_ids: string[] };
        Returns: { departure_id: string; leg_start: number; seats_taken: number }[];
      };
      request_booking: {
        Args: {
          p_departure_id: string;
          p_from_stop_id: string;
          p_to_stop_id: string;
          p_seats: number;
          p_luggage_count: number;
          p_passenger_note: string | null;
        };
        Returns: string;
      };
      approve_booking: { Args: { p_booking_id: string }; Returns: undefined };
      decline_booking: { Args: { p_booking_id: string }; Returns: undefined };
      cancel_booking: { Args: { p_booking_id: string }; Returns: undefined };
      expire_stale_holds: { Args: Record<string, never>; Returns: number };
      assign_booking_vehicle: {
        Args: { p_booking_id: string; p_vehicle_id: string | null };
        Returns: undefined;
      };
      complete_departure: { Args: { p_departure_id: string }; Returns: number };
      mark_no_show: { Args: { p_booking_id: string }; Returns: undefined };
      confirm_payment_as_passenger: {
        Args: { p_booking_id: string; p_payment_method: PaymentMethod };
        Returns: undefined;
      };
      confirm_payment_as_driver: {
        Args: { p_booking_id: string; p_received: boolean };
        Returns: undefined;
      };
      passenger_history: {
        Args: { p_passenger_id: string };
        Returns: {
          completed: number;
          cancelled: number;
          no_shows: number;
          red_flags: number;
          /** Numeric in Postgres, so it arrives as a string over PostgREST. */
          rating_avg: string | null;
          rating_count: number;
        }[];
      };
      mark_notifications_read: {
        Args: { p_ids?: string[] | null };
        Returns: number;
      };
      request_incity_ride: {
        Args: {
          p_booking_id: string;
          p_operator_id: string;
          p_pickup_stop_id: string;
          p_zone_id: string;
          p_destination_address: string;
        };
        Returns: string;
      };
      approve_incity_ride: { Args: { p_id: string }; Returns: undefined };
      decline_incity_ride: { Args: { p_id: string }; Returns: undefined };
      cancel_incity_ride: { Args: { p_id: string }; Returns: undefined };
      file_report: {
        Args: { p_booking_id: string; p_category: ReportCategory; p_note: string };
        Returns: string;
      };
      resolve_report: { Args: { p_id: string; p_resolution: string | null }; Returns: undefined };
      raise_red_flag: {
        Args: { p_booking_id: string; p_reason: RedFlagReason; p_note?: string | null };
        Returns: string;
      };
      rate_passenger: {
        Args: { p_booking_id: string; p_score: number; p_comment?: string | null };
        Returns: string;
      };
      phone_in_use: {
        Args: { p_phone: string; p_exclude?: string | null };
        Returns: boolean;
      };
      set_account_mode: {
        Args: { p_mode: 'passenger' | 'driver'; p_enabled: boolean };
        Returns: undefined;
      };
    };
    Enums: {
      platform_role: PlatformRole;
      operator_type: OperatorType;
      operator_status: OperatorStatus;
      operator_member_role: OperatorMemberRole;
      subscription_plan: SubscriptionPlan;
      subscription_status: SubscriptionStatus;
      pricing_mode: PricingMode;
      departure_status: DepartureStatus;
      payment_method: PaymentMethod;
      rating_direction: RatingDirection;
      booking_status: BookingStatus;
      red_flag_reason: RedFlagReason;
      notification_kind: NotificationKind;
      report_category: ReportCategory;
      report_status: ReportStatus;
      feedback_kind: FeedbackKind;
      incity_booking_status: IncityBookingStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
