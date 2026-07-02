// Decide whether a normalized listing satisfies a watchlist entry.
//
// A listing matches an entry only if it satisfies EVERY field present on the
// entry. Missing entry fields are ignored (treated as "any"). String fields are
// compared case-insensitively; model/trim use substring matching so an entry of
// { model: "3 Series" } matches a listing titled "BMW 330i 3 Series".

export function matchesEntry(listing, entry) {
  if (entry.make && !eq(listing.make, entry.make)) return false;
  if (entry.model && !includes(listing.model, entry.model) &&
      !includes(listing.title, entry.model)) return false;
  if (entry.trim && !includes(listing.trim, entry.trim) &&
      !includes(listing.title, entry.trim)) return false;

  if (entry.yearMin != null && (listing.year == null || listing.year < entry.yearMin)) return false;
  if (entry.yearMax != null && (listing.year == null || listing.year > entry.yearMax)) return false;

  if (entry.priceMin != null && (listing.price == null || listing.price < entry.priceMin)) return false;
  if (entry.priceMax != null && (listing.price == null || listing.price > entry.priceMax)) return false;

  if (entry.mileageMax != null && (listing.mileage == null || listing.mileage > entry.mileageMax)) return false;
  if (entry.mileageMin != null && (listing.mileage == null || listing.mileage < entry.mileageMin)) return false;

  return true;
}

// Return the list of watchlist entries a listing matches (may be more than one).
export function matchEntries(listing, watchlist) {
  return watchlist.filter((entry) => matchesEntry(listing, entry));
}

// Given all listings and the watchlist, return only the matching listings,
// annotated with which watchlist labels they matched.
export function findMatches(listings, watchlist) {
  const matches = [];
  for (const listing of listings) {
    const entries = matchEntries(listing, watchlist);
    if (entries.length) {
      matches.push({
        ...listing,
        matchedLabels: entries.map((e) => entryLabel(e)),
      });
    }
  }
  return matches;
}

export function entryLabel(entry) {
  if (entry.label) return entry.label;
  return [entry.make, entry.model, entry.trim].filter(Boolean).join(" ").trim() || "Any car";
}

function eq(a, b) {
  return norm(a) === norm(b);
}
function includes(haystack, needle) {
  return norm(haystack).includes(norm(needle));
}
function norm(v) {
  return String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
}
