'use strict';

// Seat inventory for the flights seeded in the flights service. The flight_id
// values correspond to flights_db rows 1..6 — there is no foreign key to
// enforce that, because those rows live in another database. Keeping the two
// seeders consistent is a development concern, not a runtime one.
//
// Deliberately small aircraft (6 rows x 6 seats = 36) so a load test can
// exhaust a flight quickly and the "sold out" path gets exercised for real.
//
// 36 MUST equal AIRCRAFT_CAPACITY in the flights service seeder
// (services/flights/seeders/*-demo-flights.js). If they diverge, the search
// read model advertises seats that do not exist. Nothing enforces this — the
// tables are in separate databases, so no foreign key can span them.
const FLIGHT_IDS = [1, 2, 3, 4, 5, 6];
const ROWS = 6;
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F'];

module.exports = {
  async up (queryInterface) {
    const seats = [];
    for (const flightId of FLIGHT_IDS) {
      for (let row = 1; row <= ROWS; row += 1) {
        for (const column of COLUMNS) {
          seats.push({
            flight_id: flightId,
            seat_number: `${row}${column}`,
            status: 'available',
            version: 0,
          });
        }
      }
    }
    await queryInterface.bulkInsert('flight_seats', seats);
  },

  async down (queryInterface) {
    await queryInterface.bulkDelete('flight_seats', null, {});
  }
};
