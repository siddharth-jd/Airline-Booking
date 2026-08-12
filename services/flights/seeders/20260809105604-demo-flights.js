'use strict';

const AIRPORTS = [
  { code: 'BOM', name: 'Chhatrapati Shivaji Maharaj Intl', city: 'Mumbai', country: 'India' },
  { code: 'DEL', name: 'Indira Gandhi Intl', city: 'Delhi', country: 'India' },
  { code: 'BLR', name: 'Kempegowda Intl', city: 'Bengaluru', country: 'India' },
  { code: 'MAA', name: 'Chennai Intl', city: 'Chennai', country: 'India' },
];

// CAPACITY MUST MATCH the seat rows created by the booking service's seeder
// (services/bookings/seeders/*-demo-flight-seats.js), which builds a 6x6 grid =
// 36 seats per flight.
//
// Nothing enforces this. The two tables live in different databases, so no
// foreign key and no constraint can catch a mismatch — it surfaces only as a
// read model that disagrees with reality (search advertising seats on a sold
// out flight). This is the honest, unglamorous cost of splitting services:
// consistency between them is a job someone has to do deliberately.
const AIRCRAFT_CAPACITY = 36;

const FLIGHTS = [
  { flight_number: 'AI101', origin_code: 'BOM', destination_code: 'DEL', dep: '2026-09-01T06:00:00Z', arr: '2026-09-01T08:10:00Z', price_cents: 549900 },
  { flight_number: 'AI205', origin_code: 'BOM', destination_code: 'DEL', dep: '2026-09-01T14:30:00Z', arr: '2026-09-01T16:45:00Z', price_cents: 612500 },
  { flight_number: '6E330', origin_code: 'BOM', destination_code: 'DEL', dep: '2026-09-01T20:15:00Z', arr: '2026-09-01T22:25:00Z', price_cents: 498000 },
  { flight_number: '6E411', origin_code: 'DEL', destination_code: 'BOM', dep: '2026-09-01T09:00:00Z', arr: '2026-09-01T11:15:00Z', price_cents: 505000 },
  { flight_number: 'UK810', origin_code: 'BLR', destination_code: 'DEL', dep: '2026-09-01T07:45:00Z', arr: '2026-09-01T10:30:00Z', price_cents: 587000 },
  { flight_number: 'AI440', origin_code: 'MAA', destination_code: 'BOM', dep: '2026-09-02T18:00:00Z', arr: '2026-09-02T20:05:00Z', price_cents: 471000 },
];

module.exports = {
  async up (queryInterface) {
    await queryInterface.bulkInsert('airports', AIRPORTS);
    await queryInterface.bulkInsert('flights', FLIGHTS.map((f) => ({
      flight_number: f.flight_number,
      origin_code: f.origin_code,
      destination_code: f.destination_code,
      departure_time: new Date(f.dep),
      arrival_time: new Date(f.arr),
      aircraft_capacity: AIRCRAFT_CAPACITY,
      seats_available: AIRCRAFT_CAPACITY,
      price_cents: f.price_cents,
    })));
  },

  async down (queryInterface) {
    await queryInterface.bulkDelete('flights', null, {});
    await queryInterface.bulkDelete('airports', null, {});
  }
};
