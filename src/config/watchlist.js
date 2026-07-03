// The list of cars you want to be notified about.
//
// Each entry is a set of criteria. A listing "matches" an entry when it
// satisfies every field that is present on that entry. Fields left out are
// treated as "don't care", so you can be as loose or as strict as you like.
//
//   make        string  (case-insensitive, required for a useful match)
//   model       string  (case-insensitive; substring match, e.g. "3 series")
//   trim        string  (optional; case-insensitive substring match)
//   yearMin     number  (inclusive)
//   yearMax     number  (inclusive)
//   priceMax    number  (inclusive, in dollars)
//   priceMin    number  (inclusive, in dollars)
//   mileageMax  number  (inclusive, in miles)
//   label       string  (friendly name shown in summaries; defaults to make+model)

export const watchlist = [
  {
    label: "Audi Quattro",
    make: "Audi",
    model: "Quattro",
  },
  {
    label: "Toyota Tacoma (low miles)",
    make: "Toyota",
    model: "Tacoma",
    yearMin: 2019,
    priceMax: 42000,
    mileageMax: 60000,
  },
  {
    label: "Honda Civic Type R",
    make: "Honda",
    model: "Civic",
    trim: "Type R",
    yearMin: 2018,
    priceMax: 45000,
  },
  {
    label: "Subaru Outback",
    make: "Subaru",
    model: "Outback",
    yearMin: 2020,
    priceMax: 35000,
    mileageMax: 50000,
  },
  {
    label: "Mazda MX-5 Miata",
    make: "Mazda",
    model: "MX-5",
    yearMin: 2016,
    priceMax: 30000,
  },
  {
    label: "Tesla Model 3",
    make: "Tesla",
    model: "Model 3",
    yearMin: 2021,
    priceMax: 38000,
    mileageMax: 45000,
  },
];

export default watchlist;
