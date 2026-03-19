// src/services/classifier.js

// Rules-based classifier, fallback to "uncategorized"
const classify = (from = "", subject = "") => {
  const f = from.toLowerCase();
  const s = subject.toLowerCase();

  // Jobs
  if (
    f.match(/naukri|linkedin|internshala|wellfound|freshers|hirist|instahyre/) ||
    s.match(/job|hiring|interview|offer letter|application|recruiter/)
  ) {
    return "jobs";
  }

  // Food
  if (
    f.match(/swiggy|zomato|dominos|mcdonalds|blinkit|dunzo|bigbasket/) ||
    s.match(/order|delivered|receipt|delivery|your food/)
  ) {
    return "food";
  }

  // Cabs / travel
  if (
    f.match(/uber|ola|rapido|indigo|airasia|irctc/) ||
    s.match(/trip receipt|ride|booking confirmation|ticket|pnr/)
  ) {
    return "cabs";
  }

  // Finance
  if (
    f.match(/hdfcbank|sbibank|icicibank|axisbank|kotak|paytm|phonepe|razorpay/) ||
    s.match(/statement|otp|transaction|invoice|payment|credited|debited/)
  ) {
    return "finance";
  }

  // Health
  if (
    f.match(/apollo|1mg|practo|pharmeasy|tata health/) ||
    s.match(/prescription|appointment|medicine|health|report/)
  ) {
    return "health";
  }

  // Social / notifications
  if (
    f.match(/linkedin|instagram|twitter|github|facebook|youtube/) ||
    s.match(/mentioned you|commented|new follower|connection request/)
  ) {
    return "social";
  }

  // Fallback
  return "uncategorized";
};

module.exports = { classify };
