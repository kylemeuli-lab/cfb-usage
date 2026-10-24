// Site switches (feature flags) for the members site. Flip a value to true or false and
// push; the change shows on the next page load. Anything switched off is still visible
// in the Admin view, marked "Off for members", so you can check it before turning it on.
"use strict";

const SITE_SETTINGS = {
  // Sidebar "Rank defenses by" picker. When off, defenses are ranked by yards allowed per play.
  defenseMetricPicker: false,
};
