// Catalogue of machine object types plus the cell-based machines (documented for the encyclopedia).
import { Furnace, FURNACE_INFO } from './Furnace.js';
import { FuelHeater, HEATER_INFO } from './Heater.js';
import { CoolingStation, COOLER_INFO } from './Cooler.js';

export const MACHINE_OBJECTS = {
  furnace: { ...FURNACE_INFO.furnace, group: 'Machines', create: (game) => new Furnace(game, 'furnace') },
  electric_furnace: { ...FURNACE_INFO.electric_furnace, group: 'Machines', create: (game) => new Furnace(game, 'electric_furnace') },
  fuel_heater: { ...HEATER_INFO.fuel_heater, group: 'Machines', create: (game) => new FuelHeater(game) },
  cooling_station: { ...COOLER_INFO.cooling_station, group: 'Machines', create: (game) => new CoolingStation(game) },
};

/** Cell machines are ordinary materials with behaviours; this list feeds the encyclopedia. */
export const CELL_MACHINES = [
  { key: 'battery', how: 'Always-on power source. Connect to devices with copper wire (solid metals also conduct).' },
  { key: 'solar_panel', how: 'Power source while nothing but air, gas or glass is above it.' },
  { key: 'thermocouple', how: 'Generates power while hotter than 150°C — wire it to a lamp next to a furnace.' },
  { key: 'wire', how: 'Conducts power between cells it touches (up/down/left/right). Glows yellow when live.' },
  { key: 'switch', how: 'Click with the Hand or Inspect tool (or hover + T) to toggle. Green = conducting.' },
  { key: 'thermostat', how: 'Conducts only while colder than its setpoint (Inspect to change). Keeps kilns and ovens at temperature.' },
  { key: 'heat_sensor', how: 'Conducts only while hotter than its setpoint (default 100°C). Over-heat alarms and automatic fans.' },
  { key: 'liquid_sensor', how: 'Conducts only while a liquid touches it. Tank-full and flood detectors.' },
  { key: 'pressure_plate', how: 'Conducts only while cells or an object rest directly on top. Doorbells and traps.' },
  { key: 'lamp', how: 'Glows warm white when powered.' },
  { key: 'led_red', how: 'Red / green / blue LEDs glow in colour when powered — status lights.' },
  { key: 'buzzer', how: 'Beeps while powered.' },
  { key: 'heating_element', how: 'Powered: heats toward 1100°C. Build kilns or boilers from it.' },
  { key: 'cooling_element', how: 'Powered: chills toward -60°C. Build condensers and freezers.' },
  { key: 'igniter', how: 'Powered: sprays sparks and flame into adjacent air.' },
  { key: 'fan', how: 'Powered: blows gases, fire and light powders up to 14 cells. Pick direction before placing.' },
  { key: 'conveyor', how: 'Powered: moves powders and objects resting on it. Pick direction before placing.' },
  { key: 'pump', how: 'Powered: pulls liquid from neighbouring cells (or a touching container) into an adjacent pipe.' },
  { key: 'pipe', how: 'Carries liquid away from the pump and releases it at the open end (into air or into a container).' },
];
