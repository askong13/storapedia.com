const firebaseConfig = {
    apiKey: "%REACT_APP_FIREBASE_API_KEY%",
    authDomain: "%REACT_APP_FIREBASE_AUTH_DOMAIN%",
    projectId: "%REACT_APP_FIREBASE_PROJECT_ID%",
    storageBucket: "%REACT_APP_FIREBASE_STORAGE_BUCKET%",
    messagingSenderId: "%REACT_APP_FIREBASE_MESSAGING_SENDER_ID%",
    appId: "%REACT_APP_FIREBASE_APP_ID%",
    databaseURL: "%REACT_APP_FIREBASE_DATABASE_URL%"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

let map, infoWindow, mainAutocomplete;
let currentUser = null;
let userProfile = null;
let userLocation = null;
let locationsCache = [];
let upcomingBookings = [];

let markers = [];

let currentBookingStep = 1;
let isExtendingBooking = false;

let pickupMap, pickupMarker, pickupAutocomplete, geocoder;

let dailyPrices = {};
let pickupFee = 0;

let footerLinksSettings = {};
let faqData = [];

const currencyFormatter = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
});

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    await loadSettingsAndContent();
    setupEventListeners();
    updateCopyrightYear();
    handleAuthStateChange();
}

async function loadSettingsAndContent() {
    try {
        const pricingSnapshot = await db.ref('settings/pricing').once('value');
        if (pricingSnapshot.exists()) {
            const pricing = pricingSnapshot.val();
            dailyPrices = {
                small: pricing.small || 25000,
                medium: pricing.medium || 50000,
                large: pricing.large || 90000
            };
            pickupFee = pricing.pickupFee || 150000;
        } else {
            console.warn("Pricing settings not found in RTDB. Using defaults.");
            dailyPrices = { small: 25000, medium: 50000, large: 90000 };
            pickupFee = 150000;
        }
        populateUnitSizeOptions();
        document.getElementById('pickup-fee-display').textContent = `+${currencyFormatter.format(pickupFee)}`;
        document.getElementById('pickup-fee-display-large').textContent = currencyFormatter.format(pickupFee);

        const footerLinksSnapshot = await db.ref('settings/footerLinks').once('value');
        if (footerLinksSnapshot.exists()) {
            footerLinksSettings = footerLinksSnapshot.val();
            populateFooterLinks(footerLinksSettings);
        } else {
            console.warn("Footer links settings not found in RTDB. Using defaults.");
            footerLinksSettings = {
                "solutions": [{ "text": "Personal Storage", "url": "#" }, { "text": "Business Storage", "url": "#" }, { "text": "Student Storage", "url": "#" }, { "text": "Vehicle Storage", "url": "#" }],
                "company": [{ "text": "About Us", "url": "#" }, { "text": "Careers", "url": "#" }, { "text": "Press", "url": "#" }, { "text": "Locations", "url": "#locations" }],
                "support": [{ "text": "Contact Us", "url": "#" }, { "text": "FAQs", "url": "#faq" }, { "text": "Privacy Policy", "url": "#" }, { "text": "Terms of Service", "url": "#" }],
                "social_media": [{ "platform": "facebook", "icon": "fab fa-facebook-f", "url": "#" }, { "platform": "instagram", "icon": "fab fa-instagram", "url": "#" }, { "platform": "twitter", "icon": "fab fa-twitter", "url": "#" }, { "platform": "linkedin", "icon": "fab fa-linkedin-in", "url": "#" }]
            };
            populateFooterLinks(footerLinksSettings);
        }
        await populateFAQ();
    } catch (error) {
        console.error("Error loading initial settings or content:", error);
        Swal.fire('Error', 'Failed to load app settings or content.', 'error');
    }
}

function populateUnitSizeOptions() {
    const selectElement = document.getElementById('booking-size');
    selectElement.innerHTML = '';
    const sizes = {
        small: 'Small (2m x 2m)',
        medium: 'Medium (3m x 3m)',
        large: 'Large (3m x 6m)'
    };
    for (const sizeKey in dailyPrices) {
        if (dailyPrices.hasOwnProperty(sizeKey)) {
            const price = dailyPrices[sizeKey];
            const option = document.createElement('option');
            option.value = sizeKey;
            option.textContent = `${sizes[sizeKey]} - ${currencyFormatter.format(price)}/day`;
            selectElement.appendChild(option);
        }
    }
}

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(sectionId);
    if (section) section.classList.add('active');
    window.scrollTo(0, 0);
}

function handleAuthStateChange() {
    auth.onAuthStateChanged(async (user) => {
        const authLinks = document.getElementById('auth-links');
        const userMenu = document.getElementById('user-menu');
        const mobileAuthLinks = document.getElementById('mobile-auth-links');
        const notificationArea = document.getElementById('notification-area');
        if (user) {
            currentUser = user;
            await fetchUserProfile(user.uid);
            authLinks.classList.add('hidden');
            mobileAuthLinks.classList.add('hidden');
            userMenu.classList.remove('hidden');
            notificationArea.classList.remove('hidden');
            document.getElementById('user-greeting').textContent = `Hi, ${userProfile?.name?.split(' ')[0] || 'User'}!`;
            closeAuthModal();
            if (document.getElementById('user-dashboard').classList.contains('active')) {
                loadUserDashboard();
            }
        } else {
            currentUser = null;
            userProfile = null;
            authLinks.classList.remove('hidden');
            mobileAuthLinks.classList.remove('hidden');
            userMenu.classList.add('hidden');
            notificationArea.classList.add('hidden');
            showSection('main-content');
        }
        if (user) {
            authLinks.style.display = 'none';
            mobileAuthLinks.style.display = 'none';
            userMenu.style.display = 'flex';
        } else {
            authLinks.style.display = 'flex';
            mobileAuthLinks.style.display = 'block';
            userMenu.style.display = 'none';
        }
    });
}

async function fetchUserProfile(uid) {
    try {
        const userSnapshot = await db.ref(`users/${uid}`).once('value');
        if (userSnapshot.exists()) {
            userProfile = { uid: userSnapshot.key, ...userSnapshot.val() };
        } else {
            userProfile = null;
            console.warn("User profile not found in RTDB for UID:", uid);
        }
    } catch (error) {
        console.error("Error fetching user profile:", error);
    }
}

async function handleAuth(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name').value;
    const phone = document.getElementById('auth-phone').value;
    const mode = document.getElementById('auth-mode').value;
    const submitBtn = document.getElementById('auth-submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Processing...`;
    try {
        if (mode === 'login') {
            await auth.signInWithEmailAndPassword(email, password);
            Swal.fire('Success!', 'You have successfully logged in.', 'success');
        } else {
            if (!name || !phone) {
                Swal.fire('Missing Information', 'Please provide your full name and phone number.', 'error');
                return;
            }
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            await db.ref(`users/${userCredential.user.uid}`).set({
                name: name,
                phone: phone,
                email: email,
                createdAt: firebase.database.ServerValue.TIMESTAMP
            });
            Swal.fire('Welcome!', 'Your account has been created.', 'success');
        }
    } catch (error) {
        Swal.fire(`${mode === 'login' ? 'Login' : 'Sign Up'} Failed`, error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = mode === 'login' ? 'Login' : 'Sign Up';
    }
}

function handleLogout() {
    auth.signOut().then(() => {
        Swal.fire('Logged Out', 'You have been successfully logged out.', 'info');
    });
}

function openAuthModal(mode = 'login') {
    const modal = document.getElementById('auth-modal');
    const title = document.getElementById('auth-title');
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleText = document.getElementById('auth-toggle-text');
    const nameField = document.getElementById('name-field-container');
    const phoneField = document.getElementById('phone-field-container');
    document.getElementById('auth-mode').value = mode;
    if (mode === 'login') {
        title.textContent = 'Login';
        submitBtn.textContent = 'Login';
        toggleText.innerHTML = `Don't have an account? <button id="auth-toggle-btn" class="font-medium text-[var(--primary-blue)] hover:text-[var(--secondary-blue)]">Sign Up</button>`;
        nameField.classList.add('hidden');
        phoneField.classList.add('hidden');
    } else {
        title.textContent = 'Create an Account';
        submitBtn.textContent = 'Sign Up';
        toggleText.innerHTML = `Already have an account? <button id="auth-toggle-btn" class="font-medium text-[var(--primary-blue)] hover:text-[var(--secondary-blue)]">Login</button>`;
        nameField.classList.remove('hidden');
        phoneField.classList.remove('hidden');
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('auth-form').reset();
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

window.initMap = function () {
    const defaultCenter = { lat: -8.409518, lng: 115.188919 };
    map = new google.maps.Map(document.getElementById("map"), {
        center: defaultCenter,
        zoom: 10,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        gestureHandling: 'greedy',
        styles: [{ "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#e9e9e9" }, { "lightness": 17 }] }, { "featureType": "landscape", "elementType": "geometry", "stylers": [{ "color": "#f5f5f5" }, { "lightness": 20 }] }, { "featureType": "road.highway", "elementType": "geometry.fill", "stylers": [{ "color": "#ffffff" }, { "lightness": 17 }] }, { "featureType": "road.highway", "elementType": "geometry.stroke", "stylers": [{ "color": "#ffffff" }, { "lightness": 29 }, { "weight": 0.2 }] }, { "featureType": "road.arterial", "elementType": "geometry", "stylers": [{ "color": "#ffffff" }, { "lightness": 18 }] }, { "featureType": "road.local", "elementType": "geometry", "stylers": [{ "color": "#ffffff" }, { "lightness": 16 }] }, { "featureType": "poi", "elementType": "geometry", "stylers": [{ "color": "#f5f5f5" }, { "lightness": 21 }] }, { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#dedede" }, { "lightness": 21 }] }, { "elementType": "labels.text.stroke", "stylers": [{ "visibility": "on" }, { "color": "#ffffff" }, { "lightness": 16 }] }, { "elementType": "labels.text.fill", "stylers": [{ "saturation": 36 }, { "color": "#333333" }, { "lightness": 40 }] }, { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] }, { "featureType": "transit", "elementType": "geometry", "stylers": [{ "color": "#f2f2f2" }, { "lightness": 19 }] }, { "featureType": "administrative", "elementType": "geometry.fill", "stylers": [{ "color": "#fefefe" }, { "lightness": 20 }] }, { "featureType": "administrative", "elementType": "geometry.stroke", "stylers": [{ "color": "#fefefe" }, { "lightness": 17 }, { "weight": 1.2 }] }]
    });
    infoWindow = new google.maps.InfoWindow();
    geocoder = new google.maps.Geocoder();
    const searchInput = document.getElementById('location-search-input');
    mainAutocomplete = new google.maps.places.Autocomplete(searchInput, { fields: ["geometry", "name", "formatted_address"], types: ["geocode"] });
    mainAutocomplete.addListener('place_changed', onPlaceChanged);
    fetchAndDisplayLocations();
    locateUser(true);
};

function onPlaceChanged() {
    const place = mainAutocomplete.getPlace();
    if (place.geometry && place.geometry.location) {
        userLocation = {
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
        };
        document.getElementById('location-search-input').value = place.formatted_address;
        map.setCenter(userLocation);
        map.setZoom(13);
        sortAndRenderLocations();
    } else {
        document.getElementById('location-search-input').placeholder = 'Enter an address or landmark...';
    }
}

function locateUser(isSilent = false) {
    const btn = document.getElementById('use-my-location-btn');
    const icon = document.getElementById('location-btn-icon');
    const text = document.getElementById('location-btn-text');
    const resetButton = () => {
        btn.disabled = false;
        icon.className = 'fas fa-location-arrow';
        text.textContent = 'Use My Location';
    };
    if (!isSilent) {
        btn.disabled = true;
        icon.className = 'fas fa-spinner fa-spin';
        text.textContent = 'Finding...';
    }
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };
                map.setCenter(userLocation);
                map.setZoom(13);
                sortAndRenderLocations();
                if (!isSilent) resetButton();
                geocoder.geocode({ location: userLocation }, (results, status) => {
                    if (status === 'OK' && results[0]) {
                        document.getElementById('location-search-input').value = results[0].formatted_address;
                    }
                });
            },
            () => {
                console.warn("Geolocation permission denied.");
                sortAndRenderLocations();
                if (!isSilent) {
                    resetButton();
                    Swal.fire('Location Access Denied', 'You can still search for locations manually.', 'warning');
                }
            },
            { timeout: 10000 }
        );
    } else {
        console.warn("Geolocation is not supported.");
        sortAndRenderLocations();
        if (!isSilent) resetButton();
    }
}

async function fetchAndDisplayLocations() {
    const skeleton = document.getElementById('location-list-skeleton');
    if (skeleton) {
        skeleton.style.display = 'block';
    }
    try {
        const snapshot = await db.ref('storageLocations').once('value');
        const data = snapshot.val();
        locationsCache = [];
        if (!data) {
            if (skeleton) {
                skeleton.style.display = 'none';
            }
            document.getElementById('locations-list-container').innerHTML = `<p class="text-center text-gray-500 p-4">No storage locations available at this time.</p>`;
            return;
        }
        for (let key in data) {
            if (data.hasOwnProperty(key)) {
                locationsCache.push({ id: key, ...data[key] });
            }
        }
        sortAndRenderLocations();
    } catch (error) {
        console.error("Error fetching locations: ", error);
        Swal.fire('Error', 'Could not fetch storage locations.', 'error');
        if (skeleton) {
            skeleton.style.display = 'none';
        }
    }
}

function sortAndRenderLocations() {
    if (locationsCache.length === 0) return;
    let sortedLocations = [...locationsCache].filter(loc => loc.capacity > 0);
    if (userLocation) {
        sortedLocations.forEach(loc => {
            loc.distance = haversineDistance(userLocation, { lat: loc.geolocation.latitude, lng: loc.geolocation.longitude });
        });
        sortedLocations.sort((a, b) => a.distance - b.distance);
    }
    renderLocationList(sortedLocations);
    renderMapMarkers(sortedLocations);
}

function renderLocationList(locations) {
    const listContainer = document.getElementById('locations-list-container');
    const skeleton = document.getElementById('location-list-skeleton');
    if (skeleton) {
        skeleton.style.display = 'none';
    }
    listContainer.innerHTML = '';
    if (locations.length === 0) {
        listContainer.innerHTML = `<p class="text-center text-gray-500 p-4">No available locations found near you.</p>`;
        return;
    }
    listContainer.innerHTML = locations.map(location => `
        <div class="location-card bg-white p-4 rounded-lg border border-gray-200 hover:shadow-md hover:border-[var(--primary-blue)] transition cursor-pointer" data-location-id="${location.id}">
            ${location.imageUrl ? `<img src="${location.imageUrl}" alt="${location.name}" class="location-card-image">` : ''}
            <div class="flex justify-between items-start">
                <h3 class="font-bold text-lg text-gray-800">${location.name}</h3>
                ${location.distance ? `<span class="text-sm font-semibold text-[var(--primary-blue)] bg-blue-100 px-2 py-1 rounded-full">${location.distance.toFixed(1)} km</span>` : ''}
            </div>
            <p class="text-gray-600 text-sm mt-1">${location.address}</p>
            <p class="text-green-600 font-semibold text-sm mt-2">${location.capacity} units available</p>
            ${location.features && location.features.length > 0 ? `
                <div class="location-features mt-2">
                    ${location.features.map(f => `<span class="inline-block mr-2"><i class="fas fa-check-circle"></i> ${f.name}</span>`).join('')}
                </div>
            ` : ''}
            <button class="mt-4 w-full btn-primary text-sm font-bold py-2 px-4 rounded-md" data-location-id-book="${location.id}">
                View & Book
            </button>
        </div>
    `).join('');
    listContainer.querySelectorAll('.location-card button[data-location-id-book]').forEach(button => {
        button.addEventListener('click', (e) => {
            const locationId = e.target.dataset.locationIdBook;
            startBookingProcess(locationId);
        });
    });
    listContainer.querySelectorAll('.location-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const locationId = card.dataset.locationId;
            const correspondingMarker = markers.find(m => m.locationId === locationId);
            if (correspondingMarker) {
                map.panTo(correspondingMarker.getPosition());
                map.setZoom(15);
                google.maps.event.trigger(correspondingMarker, 'click');
            }
        });
    });
}

function renderMapMarkers(locations) {
    markers.forEach(marker => marker.setMap(null));
    markers = [];
    locations.forEach(location => {
        if (location.geolocation && typeof location.geolocation.latitude === 'number' && typeof location.geolocation.longitude === 'number') {
            const marker = new google.maps.Marker({
                position: { lat: location.geolocation.latitude, lng: location.geolocation.longitude },
                map: map, title: location.name, animation: google.maps.Animation.DROP, locationId: location.id
            });
            marker.addListener('click', () => {
                const featuresHtml = location.features && location.features.length > 0 ? `
                    <div class="location-features mt-2">
                        ${location.features.map(f => `<span class="inline-block mr-2"><i class="fas fa-check-circle"></i> ${f.name}</span>`).join('')}
                    </div>
                ` : '';
                const content = `
                    <div class="p-2 font-sans">
                        ${location.imageUrl ? `<img src="${location.imageUrl}" alt="${location.name}" class="location-card-image" style="height: 100px; width: 100%; object-fit: cover; margin-bottom: 0.5rem;">` : ''}
                        <h3 class="font-bold text-lg">${location.name}</h3>
                        <p class="text-gray-600 text-sm">${location.address}</p>
                        <p class="text-green-600 font-semibold text-sm">${location.capacity} units available</p>
                        ${featuresHtml}
                        <button class="mt-3 w-full btn-primary text-white font-bold py-2 px-4 rounded" data-location-id-book="${location.id}">Book Now</button>
                    </div>
                `;
                infoWindow.setContent(content);
                infoWindow.open(map, marker);
                google.maps.event.addListenerOnce(infoWindow, 'domready', () => {
                    const bookNowBtn = infoWindow.getContent().querySelector('button[data-location-id-book]');
                    if (bookNowBtn) {
                        bookNowBtn.addEventListener('click', () => startBookingProcess(location.id));
                    }
                });
                document.querySelectorAll('.location-card').forEach(c => c.classList.remove('highlighted'));
                const card = document.querySelector(`.location-card[data-location-id="${location.id}"]`);
                if (card) {
                    card.classList.add('highlighted');
                    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
            markers.push(marker);
        }
    });
}

function haversineDistance(coords1, coords2) {
    const R = 6371;
    const dLat = (coords2.lat - coords1.lat) * Math.PI / 180;
    const dLng = (coords2.lng - coords1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(coords1.lat * Math.PI / 180) * Math.cos(coords2.lat * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startBookingProcess(locationId, booking = null) {
    const location = locationsCache.find(loc => loc.id === locationId);
    if (!location) return;
    document.getElementById('booking-form').reset();
    document.getElementById('booking-location-id').value = location.id;
    document.getElementById('booking-location-name').textContent = `at ${location.name}`;
    const bookingModalTitle = document.getElementById('booking-modal-title');
    const guestDetailsContainer = document.getElementById('guest-booking-details');
    const bookingSizeSelect = document.getElementById('booking-size');
    const bookingDatesContainer = document.getElementById('booking-dates-container');
    const bookingServiceOptions = document.getElementById('booking-service-options');
    document.getElementById('booking-booking-id').value = '';
    isExtendingBooking = (booking !== null);
    if (isExtendingBooking) {
        bookingModalTitle.textContent = 'Extend Your Unit Rental';
        document.getElementById('booking-booking-id').value = booking.id;
        guestDetailsContainer.classList.add('hidden');
        bookingSizeSelect.disabled = true;
        bookingServiceOptions.classList.add('hidden');
        bookingSizeSelect.value = booking.unitSize;
        document.getElementById('booking-start-date').value = new Date(booking.startDate).toISOString().split('T')[0];
        document.getElementById('booking-start-date').disabled = true;
        document.getElementById('booking-start-time').value = new Date(booking.startDate).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        document.getElementById('booking-start-time').disabled = true;
        const existingEndDate = new Date(booking.endDate);
        const nextDayAfterExistingEnd = new Date(existingEndDate);
        nextDayAfterExistingEnd.setDate(nextDayAfterExistingEnd.getDate() + 1);
        document.getElementById('booking-end-date').setAttribute('min', nextDayAfterExistingEnd.toISOString().split('T')[0]);
        document.getElementById('booking-end-time').value = new Date(existingEndDate).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        if (booking.serviceType === 'pickup') {
            document.querySelector('input[name="service-option"][value="pickup"]').checked = true;
        } else {
            document.querySelector('input[name="service-option"][value="self-dropoff"]').checked = true;
        }
    } else {
        bookingModalTitle.textContent = 'Book Your Unit';
        bookingSizeSelect.disabled = false;
        bookingServiceOptions.classList.remove('hidden');
        document.getElementById('booking-start-date').disabled = false;
        document.getElementById('booking-start-time').disabled = false;
        if (currentUser && userProfile) {
            guestDetailsContainer.classList.add('hidden');
            document.getElementById('booking-name').value = userProfile.name || '';
            document.getElementById('booking-phone').value = userProfile.phone || '';
            document.getElementById('booking-email').value = userProfile.email || '';
        } else {
            guestDetailsContainer.classList.remove('hidden');
        }
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const todayStr = today.toISOString().split('T')[0];
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        document.getElementById('booking-start-date').setAttribute('min', todayStr);
        document.getElementById('booking-end-date').setAttribute('min', tomorrowStr);
        document.getElementById('booking-end-date').value = tomorrowStr;
    }
    currentBookingStep = 1;
    showBookingStep(1);
    const modal = document.getElementById('booking-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function showBookingStep(step) {
    document.querySelectorAll('.booking-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`booking-step-${step}`).classList.add('active');
    const backBtn = document.getElementById('booking-back-btn');
    const nextBtn = document.getElementById('booking-next-btn');
    backBtn.style.visibility = (step === 1) ? 'hidden' : 'visible';
    if (step === 3) {
        updateBookingSummary();
        const paymentOption = document.querySelector('input[name="payment-option"]:checked').value;
        nextBtn.textContent = paymentOption === 'online' ? 'Proceed to Payment' : 'Confirm Booking';
    } else {
        nextBtn.textContent = 'Next';
    }
    if (step === 2 && !pickupMap) {
        initPickupMap();
    }
}

function navigateBookingStep(direction) {
    const isPickup = document.querySelector('input[name="service-option"]:checked').value === 'pickup';
    if (direction === 'next') {
        if (!validateBookingStep(currentBookingStep)) return;
        if (currentBookingStep === 3) {
            handleBookingSubmit();
            return;
        }
        currentBookingStep = (currentBookingStep === 1 && !isPickup) ? 3 : currentBookingStep + 1;
    } else {
        currentBookingStep = (currentBookingStep === 3 && !isPickup) ? 1 : currentBookingStep - 1;
    }
    showBookingStep(currentBookingStep);
}

function validateBookingStep(step) {
    if (step === 1) {
        if (!currentUser && !isExtendingBooking) {
            if (!document.getElementById('booking-name').value || !document.getElementById('booking-phone').value || !document.getElementById('booking-email').value) {
                Swal.fire('Incomplete Details', 'Please fill in your name, phone, and email to continue.', 'warning');
                return false;
            }
        }
        const startDate = document.getElementById('booking-start-date').value;
        const startTime = document.getElementById('booking-start-time').value;
        const endDate = document.getElementById('booking-end-date').value;
        const endTime = document.getElementById('booking-end-time').value;
        if (!startDate || !startTime || !endDate || !endTime) {
            Swal.fire('Incomplete Dates/Times', 'Please select both start/end dates and times.', 'warning');
            return false;
        }
        const startDateTime = new Date(`${startDate}T${startTime}`);
        const endDateTime = new Date(`${endDate}T${endTime}`);
        if (endDateTime <= startDateTime) {
            Swal.fire('Invalid Dates/Times', 'End date and time must be after the start date and time.', 'warning');
            return false;
        }
        if (isExtendingBooking) {
            const originalBookingId = document.getElementById('booking-booking-id').value;
            const originalBooking = userBookingsCache.find(b => b.id === originalBookingId);
            if (originalBooking) {
                const originalEndDate = new Date(originalBooking.endDate);
                if (endDateTime <= originalEndDate) {
                    Swal.fire('Invalid End Date', 'The new end date for extension must be after the current booking end date.', 'warning');
                    return false;
                }
            }
        }
    }
    if (step === 2) {
        if (document.querySelector('input[name="service-option"]:checked').value === 'pickup') {
            if (!document.getElementById('pickup-address-input').value) {
                Swal.fire('Missing Address', 'Please provide a pickup address.', 'warning');
                return false;
            }
        }
    }
    return true;
}

async function handleBookingSubmit() {
    const nextBtn = document.getElementById('booking-next-btn');
    nextBtn.disabled = true;
    nextBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Processing...`;
    let userId = currentUser?.uid;
    if (!currentUser && !isExtendingBooking) {
        const name = document.getElementById('booking-name').value;
        const email = document.getElementById('booking-email').value;
        const phone = document.getElementById('booking-phone').value;
        try {
            const signInMethods = await auth.fetchSignInMethodsForEmail(email);
            if (signInMethods && signInMethods.length > 0) {
                Swal.fire('Account Exists', 'This email is already registered. Please log in to book or use a different email.', 'error');
                openAuthModal('login');
                nextBtn.disabled = false; nextBtn.innerHTML = 'Next';
                return;
            }
            const tempPassword = Math.random().toString(36).slice(-8);
            const userCredential = await auth.createUserWithEmailAndPassword(email, tempPassword);
            userId = userCredential.user.uid;
            await db.ref(`users/${userId}`).set({ name, phone, email, createdAt: firebase.database.ServerValue.TIMESTAMP });
            await auth.signInWithEmailAndPassword(email, tempPassword);
            Swal.fire('Account Created!', 'We\'ve created an account for you. Your temporary password is sent to your email (simulated). You can change it in your dashboard.', 'info');
        } catch (error) {
            console.error("Guest user registration failed:", error);
            Swal.fire('Registration Failed', error.message, 'error');
            nextBtn.disabled = false; nextBtn.innerHTML = 'Next';
            return;
        }
    }
    const paymentMethod = document.querySelector('input[name="payment-option"]:checked').value;
    const { bookingData } = getBookingData();
    bookingData.userId = userId || auth.currentUser.uid;
    bookingData.paymentMethod = paymentMethod;
    if (isExtendingBooking) {
        const originalBookingId = document.getElementById('booking-booking-id').value;
        bookingData.originalBookingId = originalBookingId;
        bookingData.isExtension = true;
    }
    if (paymentMethod === 'online') {
        bookingData.paymentStatus = 'paid';
        simulateMidtransPayment(bookingData);
    } else {
        bookingData.paymentStatus = 'unpaid_on_site';
        const newBookingRef = await saveBookingToFirestore(bookingData);
        closeBookingModal();
        Swal.fire('Booking Confirmed!', 'Your unit is reserved. Please pay upon arrival. Check your dashboard for details.', 'success');
        if (isExtendingBooking && newBookingRef) {
            await db.ref(`bookings/${bookingData.originalBookingId}`).transaction(currentBooking => {
                if (currentBooking) {
                    currentBooking.endDate = bookingData.endDate;
                    currentBooking.totalPrice = (currentBooking.totalPrice || 0) + bookingData.totalPrice;
                }
                return currentBooking;
            });
            Swal.fire('Extension Confirmed!', 'Your booking has been extended. Payment is due on-site. Check your dashboard for updated details.', 'success');
        }
    }
}

function simulateMidtransPayment(bookingData) {
    Swal.fire({
        title: 'Redirecting to Payment...',
        text: 'This is a simulated payment. You will not be charged.',
        icon: 'info',
        timer: 2500,
        showConfirmButton: false,
        allowOutsideClick: false,
    }).then(async () => {
        Swal.fire({ title: 'Payment Successful!', text: 'Saving your booking...', icon: 'success', showConfirmButton: false, allowOutsideClick: false });
        const newBookingRef = await saveBookingToFirestore(bookingData);
        closeBookingModal();
        Swal.fire('Booking Confirmed!', 'Your storage unit is booked. Check your dashboard for details.', 'success');
        if (isExtendingBooking && newBookingRef) {
            await db.ref(`bookings/${bookingData.originalBookingId}`).transaction(currentBooking => {
                if (currentBooking) {
                    currentBooking.endDate = bookingData.endDate;
                    currentBooking.totalPrice = (currentBooking.totalPrice || 0) + bookingData.totalPrice;
                }
                return currentBooking;
            });
            Swal.fire('Extension Confirmed!', 'Your booking has been extended and paid. Check your dashboard for updated details.', 'success');
        }
    });
}

async function saveBookingToFirestore(bookingData) {
    try {
        const newBookingRef = db.ref('bookings').push();
        bookingData.id = newBookingRef.key;
        await newBookingRef.set(bookingData);
        if (!isExtendingBooking) {
            const locationRef = db.ref(`storageLocations/${bookingData.locationId}`);
            await locationRef.transaction(currentCapacity => {
                if (currentCapacity && currentCapacity.capacity !== undefined) {
                    currentCapacity.capacity = Math.max(0, currentCapacity.capacity - 1);
                }
                return currentCapacity;
            });
        }
        if (auth.currentUser) loadUserDashboard();
        return newBookingRef;
    } catch (error) {
        console.error("Error saving booking: ", error);
        Swal.fire('Save Error', 'We had trouble saving your booking. Please contact support.', 'error');
        return null;
    }
}

function getBookingData() {
    const locationId = document.getElementById('booking-location-id').value;
    const size = document.getElementById('booking-size').value;
    const startDate = document.getElementById('booking-start-date').value;
    const startTime = document.getElementById('booking-start-time').value;
    const endDate = document.getElementById('booking-end-date').value;
    const endTime = document.getElementById('booking-end-time').value;
    const serviceType = document.querySelector('input[name="service-option"]:checked').value;
    const startDateTime = new Date(`${startDate}T${startTime}`);
    const endDateTime = new Date(`${endDate}T${endTime}`);
    let rentalDays;
    let storageCost;
    let currentPickupFee = (serviceType === 'pickup') ? pickupFee : 0;
    let originalBookingForExtension = null;
    if (isExtendingBooking) {
        const originalBookingId = document.getElementById('booking-booking-id').value;
        originalBookingForExtension = userBookingsCache.find(b => b.id === originalBookingId);
        if (originalBookingForExtension) {
            const originalEndDate = new Date(originalBookingForExtension.endDate);
            const timeDifference = endDateTime.getTime() - originalEndDate.getTime();
            rentalDays = Math.max(0, Math.ceil(timeDifference / (1000 * 60 * 60 * 24)));
            storageCost = rentalDays * dailyPrices[size];
            currentPickupFee = 0;
        } else {
            rentalDays = 0;
            storageCost = 0;
            currentPickupFee = 0;
        }
    } else {
        rentalDays = (startDateTime && endDateTime && endDateTime > startDateTime) ? Math.ceil((endDateTime - startDateTime) / (1000 * 60 * 60 * 24)) : 0;
        storageCost = rentalDays * dailyPrices[size];
    }
    const totalPrice = storageCost + currentPickupFee;
    const bookingData = {
        locationId: locationId,
        locationName: locationsCache.find(l => l.id === locationId).name,
        unitSize: size,
        startDate: startDateTime.getTime(),
        endDate: endDateTime.getTime(),
        totalPrice: totalPrice,
        serviceType: serviceType,
        bookingStatus: 'active',
        createdAt: firebase.database.ServerValue.TIMESTAMP
    };
    if (serviceType === 'pickup') {
        bookingData.pickupDetails = {
            address: document.getElementById('pickup-address-input').value,
            fee: pickupFee
        };
    }
    return {
        priceBreakdown: { rentalDays, storageCost, pickupFee: currentPickupFee, totalPrice },
        bookingData
    };
}

function updateBookingSummary() {
    const { priceBreakdown } = getBookingData();
    document.getElementById('summary-days').textContent = `${priceBreakdown.rentalDays} days`;
    document.getElementById('summary-storage-cost').textContent = currencyFormatter.format(priceBreakdown.storageCost);
    document.getElementById('summary-pickup-cost').textContent = currencyFormatter.format(priceBreakdown.pickupFee);
    document.getElementById('summary-pickup-row').style.display = (priceBreakdown.pickupFee > 0) ? 'flex' : 'none';
    document.getElementById('summary-total-price').textContent = currencyFormatter.format(priceBreakdown.totalPrice);
}

function closeBookingModal() {
    const modal = document.getElementById('booking-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.getElementById('booking-form').reset();
    const nextBtn = document.getElementById('booking-next-btn');
    nextBtn.disabled = false;
    nextBtn.innerHTML = 'Next';
    isExtendingBooking = false;
}

function initPickupMap() {
    const defaultPos = userLocation || { lat: -8.409518, lng: 115.188919 };
    pickupMap = new google.maps.Map(document.getElementById('pickup-map'), {
        center: defaultPos,
        zoom: 15,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        gestureHandling: 'greedy'
    });
    pickupMarker = new google.maps.Marker({
        map: pickupMap,
        position: defaultPos,
        draggable: true,
        animation: google.maps.Animation.DROP,
    });
    pickupMarker.addListener('dragend', () => {
        updateAddressFromLatLng(pickupMarker.getPosition());
    });
    const addressInput = document.getElementById('pickup-address-input');
    pickupAutocomplete = new google.maps.places.Autocomplete(addressInput, {
        fields: ["formatted_address", "geometry"],
        componentRestrictions: { country: "id" }
    });
    pickupAutocomplete.bindTo('bounds', pickupMap);
    pickupAutocomplete.addListener('place_changed', () => {
        const place = pickupAutocomplete.getPlace();
        if (place.geometry && place.geometry.location) {
            pickupMap.setCenter(place.geometry.location);
            pickupMap.setZoom(17);
            pickupMarker.setPosition(place.geometry.location);
            addressInput.value = place.formatted_address;
        }
    });
    document.getElementById('pickup-detect-location').addEventListener('click', () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
                const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                pickupMap.setCenter(newPos);
                pickupMarker.setPosition(newPos);
                updateAddressFromLatLng(newPos);
            });
        }
    });
    updateAddressFromLatLng(defaultPos);
}

function updateAddressFromLatLng(latLng) {
    geocoder.geocode({ location: latLng }, (results, status) => {
        if (status === 'OK' && results[0]) {
            document.getElementById('pickup-address-input').value = results[0].formatted_address;
        } else {
            console.warn('Geocoder failed due to: ' + status);
            document.getElementById('pickup-address-input').value = 'Address not found';
        }
    });
}

let userBookingsCache = [];

async function loadUserDashboard() {
    if (!auth.currentUser) { openAuthModal('login'); return; }
    showSection('user-dashboard');
    document.getElementById('dashboard-content').classList.add('hidden');
    document.getElementById('dashboard-content-loader').classList.remove('hidden');
    renderUserProfile();
    db.ref('bookings').orderByChild('userId').equalTo(auth.currentUser.uid)
        .on('value', snapshot => {
            userBookingsCache = [];
            snapshot.forEach(childSnapshot => {
                userBookingsCache.push({ id: childSnapshot.key, ...childSnapshot.val() });
            });
            userBookingsCache.sort((a, b) => b.createdAt - a.createdAt);
            renderUserBookings();
            checkAndDisplayNotifications();
        }, error => {
            console.error("Error listening to bookings: ", error);
        });
    document.getElementById('dashboard-content-loader').classList.add('hidden');
    document.getElementById('dashboard-content').classList.remove('hidden');
}

function renderUserProfile() {
    const profileDetails = document.getElementById('profile-details');
    if (!userProfile) { profileDetails.innerHTML = `<p class="text-gray-500">Could not load profile.</p>`; return; }
    profileDetails.innerHTML = `<p><strong class="font-semibold text-gray-500">Name:</strong><br><span class="text-lg">${userProfile.name}</span></p><p><strong class="font-semibold text-gray-500">Email:</strong><br><span class="text-lg">${userProfile.email}</span></p><p><strong class="font-semibold text-gray-500">Phone:</strong><br><span class="text-lg">${userProfile.phone || 'Not provided'}</span></p>`;
}

async function renderUserBookings() {
    const bookingsList = document.getElementById('bookings-list');
    const bookings = [...userBookingsCache];
    if (bookings.length === 0) {
        bookingsList.innerHTML = `<div class="text-center bg-gray-50 p-8 rounded-lg"><i class="fas fa-box-open text-4xl text-gray-400 mb-4"></i><h3 class="font-semibold text-xl">No Bookings Yet</h3><p class="text-gray-600 mt-2">Ready to declutter? Find your perfect storage space now.</p><a href="#locations" class="mt-4 inline-block btn-primary font-bold px-6 py-2 rounded-lg nav-link" data-target="locations">Find a Location</a></div>`;
        return;
    }
    bookingsList.innerHTML = bookings.map(booking => {
        const startDate = new Date(booking.startDate).toLocaleDateString('en-GB');
        const startTime = new Date(booking.startDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const endDate = new Date(booking.endDate).toLocaleDateString('en-GB');
        const endTime = new Date(booking.endDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const now = Date.now();
        const bookingEndDate = booking.endDate;
        const isExpired = now > bookingEndDate;
        const bookingStatusClass = isExpired ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800';
        const bookingStatusText = isExpired ? 'Expired' : 'Active';
        const paymentStatusClass = booking.paymentStatus === 'paid' ? 'text-green-600' : 'text-yellow-600';
        const paymentStatusText = booking.paymentStatus === 'paid' ? 'Paid' : 'Pay on Site';
        let countdownHtml = '';
        if (!isExpired) {
            const timeLeft = bookingEndDate - now;
            const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
            if (daysLeft > 0) {
                countdownHtml = `<p class="text-sm text-gray-700 mt-2"><i class="fas fa-clock mr-1"></i>Expires in <strong>${daysLeft} days</strong></p>`;
            }
        }
        const extendButton = !isExpired && (booking.bookingStatus === 'active' || booking.bookingStatus === 'checked_in') ? `<button class="btn-primary text-sm font-bold py-2 px-4 rounded-md mt-4 extend-booking-btn" data-booking-id="${booking.id}" data-location-id="${booking.locationId}">Extend Booking</button>` : '';
        return `
            <div class="bg-white p-6 rounded-lg shadow-md border-l-4 ${isExpired ? 'border-red-400' : 'border-green-500'}">
                <div class="flex flex-col sm:flex-row justify-between sm:items-start gap-2">
                    <div>
                        <h3 class="text-xl font-bold capitalize">${booking.unitSize} Unit at ${booking.locationName}</h3>
                        <p class="text-gray-500 text-xs mt-1">Booking ID: ${booking.id}</p>
                    </div>
                    <span class="text-sm font-bold px-3 py-1 rounded-full ${bookingStatusClass} self-start sm:self-center">${booking.bookingStatus.replace('_', ' ').charAt(0).toUpperCase() + booking.bookingStatus.slice(1).replace('_', ' ')}</span>
                </div>
                <div class="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm border-t pt-4">
                    <div>
                        <p class="text-gray-500">Start Date & Time</p>
                        <p class="font-semibold">${startDate} ${startTime}</p>
                    </div>
                    <div>
                        <p class="text-gray-500">End Date & Time</p>
                        <p class="font-semibold">${endDate} ${endTime}</p>
                        ${countdownHtml}
                    </div>
                    <div>
                        <p class="text-gray-500">Payment</p>
                        <p class="font-semibold ${paymentStatusClass}">${paymentStatusText} <span class="text-gray-800">(${currencyFormatter.format(booking.totalPrice)})</span></p>
                    </div>
                </div>
                ${booking.serviceType === 'pickup' && booking.pickupDetails ? `<div class="mt-4 bg-blue-50 p-3 rounded-md text-sm"><p class="font-semibold text-blue-800"><i class="fas fa-truck mr-2"></i>Pickup Scheduled</p><p class="text-blue-700 pl-5">${booking.pickupDetails.address}</p></div>` : ''}
                <div class="mt-4 flex flex-wrap gap-3">
                        <button class="btn-primary text-sm font-bold py-2 px-4 rounded-md" onclick="showQrCodeForBooking('${booking.id}')">Show QR Code</button>
                        <button class="btn-primary text-sm font-bold py-2 px-4 rounded-md download-invoice-btn" data-booking-id="${booking.id}">Download Invoice</button>
                        ${extendButton}
                </div>
            </div>
        `;
    }).join('');
    document.querySelectorAll('.extend-booking-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const bookingId = event.target.dataset.bookingId;
            const locationId = event.target.dataset.locationId;
            const bookingToExtend = userBookingsCache.find(b => b.id === bookingId);
            if (bookingToExtend) {
                Swal.close();
                startBookingProcess(locationId, bookingToExtend);
            } else {
                Swal.fire('Error', 'Could not find booking details for extension.', 'error');
            }
        });
    });
    document.querySelectorAll('.download-invoice-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const bookingId = event.target.dataset.bookingId;
            generateInvoicePdf(bookingId);
        });
    });
}

function checkAndDisplayNotifications() {
    upcomingBookings = [];
    const now = Date.now();
    const notificationCountElement = document.getElementById('notification-count');
    const notificationArea = document.getElementById('notification-area');
    let count = 0;
    userBookingsCache.forEach(booking => {
        const bookingEndDate = booking.endDate;
        const timeLeft = bookingEndDate - now;
        const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
        if (daysLeft > 0 && daysLeft <= 7 && ['active', 'checked_in'].includes(booking.bookingStatus)) {
            upcomingBookings.push({ ...booking, daysLeft });
            count++;
        }
    });
    if (count > 0) {
        notificationCountElement.textContent = count;
        notificationCountElement.style.display = 'block';
    } else {
        notificationCountElement.style.display = 'none';
    }
}

function showNotificationsPopup() {
    if (upcomingBookings.length === 0) {
        Swal.fire({
            title: 'No Notifications',
            text: 'You have no upcoming booking expirations.',
            icon: 'info',
            confirmButtonColor: 'var(--primary-blue)'
        });
        return;
    }
    let notificationHtml = '<ul>';
    upcomingBookings.sort((a, b) => a.daysLeft - b.daysLeft).forEach(booking => {
        const expirationText = booking.daysLeft === 1 ? 'tomorrow' : `in ${booking.daysLeft} days`;
        notificationHtml += `
            <li class="mb-3 p-3 border border-gray-200 rounded-lg">
                <p class="font-semibold text-base">Your <span class="capitalize">${booking.unitSize}</span> unit at <strong>${booking.locationName}</strong> expires ${expirationText}.</p>
                <button class="mt-2 btn-primary text-sm font-bold py-1 px-3 rounded-md notification-extend-btn"
                        data-booking-id="${booking.id}" data-location-id="${booking.locationId}">Extend Now!</button>
            </li>
        `;
    });
    notificationHtml += '</ul>';
    Swal.fire({
        title: 'Upcoming Bookings Expire Soon!',
        html: notificationHtml,
        icon: 'warning',
        showConfirmButton: false,
        showCloseButton: true,
        customClass: {
            popup: 'w-full max-w-md'
        },
        didOpen: () => {
            document.querySelectorAll('.notification-extend-btn').forEach(button => {
                button.addEventListener('click', (event) => {
                    const bookingId = event.target.dataset.bookingId;
                    const locationId = event.target.dataset.locationId;
                    const bookingToExtend = userBookingsCache.find(b => b.id === bookingId);
                    if (bookingToExtend) {
                        Swal.close();
                        startBookingProcess(locationId, bookingToExtend);
                    } else {
                        Swal.fire('Error', 'Could not find booking details for extension.', 'error');
                    }
                });
            });
        }
    });
}

function showNotification(message, type = 'info') {
    Swal.fire({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 5000,
        timerProgressBar: true,
        icon: type,
        title: message
    });
}

async function handleEditProfile() {
    if (!userProfile) return;
    const { value: formValues } = await Swal.fire({
        title: 'Edit Your Profile',
        html: `<input id="swal-name" class="swal2-input" placeholder="Full Name" value="${userProfile.name}"><input id="swal-phone" class="swal2-input" placeholder="Phone Number" value="${userProfile.phone || ''}">`,
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Save Changes', confirmButtonColor: 'var(--primary-blue)',
        preConfirm: () => [document.getElementById('swal-name').value, document.getElementById('swal-phone').value]
    });
    if (formValues) {
        const [newName, newPhone] = formValues;
        try {
            await db.ref(`users/${currentUser.uid}`).update({ name: newName, phone: newPhone });
            await fetchUserProfile(currentUser.uid);
            renderUserProfile();
            document.getElementById('user-greeting').textContent = `Hi, ${userProfile.name.split(' ')[0]}!`;
            Swal.fire('Success!', 'Your profile has been updated.', 'success');
        } catch (error) {
            console.error("Error updating profile: ", error);
            Swal.fire('Error', 'Could not update your profile.', 'error');
        }
    }
}

function showQrCodeForBooking(bookingId) {
    const qrCanvas = document.getElementById('qrcode-canvas');
    const qrModal = document.getElementById('qr-modal');
    const context = qrCanvas.getContext('2d');
    context.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    new QRious({
        element: qrCanvas,
        value: bookingId,
        size: 200,
        padding: 10
    });
    qrModal.classList.remove('hidden');
    qrModal.classList.add('flex');
}

function closeQrModal() {
    document.getElementById('qr-modal').classList.add('hidden');
    document.getElementById('qr-modal').classList.remove('flex');
}

async function generateInvoicePdf(bookingId) {
    const booking = userBookingsCache.find(b => b.id === bookingId);
    if (!booking) {
        Swal.fire('Error', 'Booking details not found.', 'error');
        return;
    }
    if (!userProfile) {
        Swal.fire('Error', 'User profile not found. Cannot generate invoice.', 'error');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const primaryBlue = '#00A6FB';
    doc.setFontSize(36);
    doc.setTextColor(primaryBlue);
    doc.text("STORAPEDIA", 10, 20);
    doc.setFontSize(22);
    doc.setTextColor('#333333');
    doc.text("INVOICE", 170, 20, null, null, 'right');
    doc.setDrawColor(primaryBlue);
    doc.setLineWidth(1);
    doc.line(10, 25, 200, 25);
    doc.setFontSize(10);
    doc.setTextColor('#666666');
    doc.text(`Invoice ID: ${booking.id.substring(0, 8).toUpperCase()}`, 170, 35, null, null, 'right');
    doc.text(`Date: ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}`, 170, 40, null, null, 'right');
    doc.text(`Booking ID: ${booking.id}`, 170, 45, null, null, 'right');
    doc.setFontSize(12);
    doc.setTextColor('#333333');
    doc.text("Bill To:", 10, 50);
    doc.setFontSize(10);
    doc.text(`Name: ${userProfile.name}`, 10, 57);
    doc.text(`Email: ${userProfile.email}`, 10, 62);
    doc.text(`Phone: ${userProfile.phone || 'N/A'}`, 10, 67);
    doc.setFontSize(14);
    doc.setTextColor('#333333');
    doc.text("Booking Summary:", 10, 80);
    const startDate = new Date(booking.startDate).toLocaleDateString('en-GB');
    const startTime = new Date(booking.startDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const endDate = new Date(booking.endDate).toLocaleDateString('en-GB');
    const endTime = new Date(booking.endDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const itemDetails = [];
    const unitPrice = dailyPrices[booking.unitSize];
    const rentalDays = Math.ceil((new Date(booking.endDate) - new Date(booking.startDate)) / (1000 * 60 * 60 * 24));
    const storageCost = rentalDays * unitPrice;
    itemDetails.push(['Storage Unit Rental', `${booking.unitSize} unit at ${booking.locationName}`, `${rentalDays} days`, currencyFormatter.format(unitPrice), currencyFormatter.format(storageCost)]);
    if (booking.serviceType === 'pickup' && booking.pickupDetails) {
        itemDetails.push(['Pickup Service', booking.pickupDetails.address, '1', currencyFormatter.format(pickupFee), currencyFormatter.format(pickupFee)]);
    }
    doc.autoTable({
        startY: 85,
        head: [['Item', 'Description', 'Quantity/Days', 'Unit Price', 'Amount']],
        body: itemDetails,
        theme: 'striped',
        headStyles: { fillColor: primaryBlue },
        styles: { font: 'Inter', fontSize: 10, cellPadding: 3 },
        columnStyles: {
            0: { cellWidth: 40 },
            1: { cellWidth: 60 },
            2: { cellWidth: 30, halign: 'center' },
            3: { cellWidth: 30, halign: 'right' },
            4: { cellWidth: 30, halign: 'right' }
        }
    });
    const finalY = doc.autoTable.previous.finalY;
    doc.setFontSize(12);
    doc.setTextColor('#333333');
    doc.text("Total Amount:", 150, finalY + 10, null, null, 'right');
    doc.setFontSize(14);
    doc.setTextColor(primaryBlue);
    doc.text(`${currencyFormatter.format(booking.totalPrice)}`, 200, finalY + 10, null, null, 'right');
    doc.setFontSize(10);
    doc.setTextColor('#666666');
    doc.text(`Payment Status: ${booking.paymentStatus === 'paid' ? 'Paid' : 'Unpaid - Pay on Site'}`, 200, finalY + 17, null, null, 'right');
    doc.setFontSize(10);
    doc.setTextColor('#666666');
    doc.text("Thank you for choosing Storapedia!", 10, doc.internal.pageSize.height - 20);
    doc.text("For any inquiries, please contact our support.", 10, doc.internal.pageSize.height - 15);
    doc.save(`invoice_storapedia_${booking.id}.pdf`);
}

async function populateFAQ() {
    try {
        const snapshot = await db.ref('faqs').orderByChild('order').once('value');
        faqData = [];
        if (snapshot.exists()) {
            snapshot.forEach(childSnapshot => {
                faqData.push({ id: childSnapshot.key, ...childSnapshot.val() });
            });
        } else {
            console.warn("No FAQs found in RTDB. Using hardcoded defaults.");
            faqData = [{ q: "How does the booking process work?", a: "It's simple! Find a location, click 'View & Book', select your unit size, rental dates, and any extra services like pickup. You can choose to pay securely online or pay on site upon arrival." }, { q: "What can I store in the units?", a: "You can store most household and business items, such as furniture, documents, inventory, and equipment. We prohibit storing hazardous materials, perishables, illegal items, and live animals." }, { q: "How does the Pickup Service work?", a: "When booking, you can choose 'Schedule Pickup'. Provide your address and we will arrange a team to pick up your items and transport them to your storage unit for a flat fee." }, { q: "How do I make payments?", a: "We offer two flexible options: pay immediately online via our secure Midtrans gateway (accepting cards, bank transfers, e-wallets) or choose to pay on site when you arrive at the facility." }, { q: "Can I access my unit anytime?", a: "Most facilities offer 24/7 access, but access hours can vary by location. Please check the specific location details before booking." }];
        }
        const container = document.getElementById('faq-container');
        container.innerHTML = faqData.map(item => `
            <div class="border-b border-gray-200">
                <div class="faq-question p-5 cursor-pointer flex justify-between items-center hover:bg-gray-50">
                    <h4 class="font-semibold text-lg">${item.q}</h4>
                    <i class="fas fa-chevron-down faq-icon transition-transform duration-300"></i>
                </div>
                <div class="faq-answer overflow-hidden max-h-0 transition-all duration-300 ease-in-out px-5">
                    <p class="text-gray-600 pb-5">${item.a}</p>
                </div>
            </div>
        `).join('');
        container.querySelectorAll('.faq-question').forEach(el => {
            el.addEventListener('click', () => {
                const answer = el.nextElementSibling, icon = el.querySelector('.faq-icon');
                const isOpening = !answer.style.maxHeight || answer.style.maxHeight === '0px';
                container.querySelectorAll('.faq-answer').forEach(ans => { ans.style.maxHeight = '0px'; ans.previousElementSibling.querySelector('.faq-icon').classList.remove('rotate-180'); });
                if (isOpening) { answer.style.maxHeight = answer.scrollHeight + "px"; icon.classList.add('rotate-180'); }
            });
        });
    } catch (error) {
        console.error("Error populating FAQs:", error);
        document.getElementById('faq-container').innerHTML = '<p class="text-red-500 text-center p-4">Failed to load FAQs.</p>';
    }
}

function populateFooterLinks(linksData) {
    const footerLinksContainer = document.getElementById('footer-links-container');
    const socialMediaContainer = document.getElementById('footer-social-media');
    footerLinksContainer.innerHTML = '';
    socialMediaContainer.innerHTML = '';
    for (const category in linksData) {
        if (linksData.hasOwnProperty(category)) {
            if (Array.isArray(linksData[category])) {
                if (category === 'social_media') {
                    linksData[category].forEach(link => {
                        socialMediaContainer.innerHTML += `<a href="${link.url || '#'}" class="hover:text-white" title="${link.platform.charAt(0).toUpperCase() + link.platform.slice(1)}"><i class="${link.icon} text-xl"></i></a>`;
                    });
                } else {
                    const div = document.createElement('div');
                    div.innerHTML = `<h3 class="font-bold text-white uppercase tracking-wider">${category.replace('_', ' ')}</h3>`;
                    const ul = document.createElement('div');
                    ul.className = 'mt-4 flex flex-col space-y-2';
                    linksData[category].forEach(link => {
                        ul.innerHTML += `<a href="${link.url || '#'}" class="nav-link hover:text-white" data-target="${link.url.replace('#', '')}">${link.text}</a>`;
                    });
                    div.appendChild(ul);
                    footerLinksContainer.appendChild(div);
                }
            }
        }
    }
    document.querySelectorAll('#footer-links-container .nav-link, #footer-social-media .nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.dataset.target, mainContent = document.getElementById('main-content');
            if (document.getElementById('mobile-menu').classList.contains('hidden') === false) {
                document.getElementById('mobile-menu').classList.add('hidden');
            }
            if (targetId === 'home' || targetId === 'locations' || targetId === 'how-it-works' || targetId === 'faq') {
                showSection('main-content');
                const targetElement = document.getElementById(targetId);
                if (targetElement) targetElement.scrollIntoView({ behavior: 'smooth' });
            } else {
                const targetElement = document.getElementById(targetId);
                if (targetElement) targetElement.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}

function updateCopyrightYear() { document.getElementById('copyright-year').textContent = new Date().getFullYear(); }

function setupEventListeners() {
    document.getElementById('login-btn').addEventListener('click', () => openAuthModal('login'));
    document.getElementById('signup-btn').addEventListener('click', () => openAuthModal('signup'));
    document.getElementById('mobile-login-btn').addEventListener('click', () => openAuthModal('login'));
    document.getElementById('mobile-signup-btn').addEventListener('click', () => openAuthModal('signup'));
    document.getElementById('close-auth-modal').addEventListener('click', closeAuthModal);
    document.getElementById('auth-form').addEventListener('submit', handleAuth);
    document.getElementById('auth-modal').addEventListener('click', (e) => {
        if (e.target.id === 'auth-toggle-btn') { openAuthModal(document.getElementById('auth-mode').value === 'login' ? 'signup' : 'login'); }
        if (e.target.id === 'auth-modal') closeAuthModal();
    });
    document.getElementById('user-menu-button').addEventListener('click', () => document.getElementById('user-menu-dropdown').classList.toggle('hidden'));
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('dashboard-btn').addEventListener('click', loadUserDashboard);
    document.getElementById('edit-profile-btn').addEventListener('click', handleEditProfile);
    document.getElementById('notification-button').addEventListener('click', showNotificationsPopup);
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.dataset.target, mainContent = document.getElementById('main-content');
            if (document.getElementById('mobile-menu').classList.contains('hidden') === false) {
                document.getElementById('mobile-menu').classList.add('hidden');
            }
            if (targetId === 'home' || targetId === 'locations' || targetId === 'how-it-works' || targetId === 'faq') {
                showSection('main-content');
                const targetElement = document.getElementById(targetId);
                if (targetElement) targetElement.scrollIntoView({ behavior: 'smooth' });
            } else {
                const targetElement = document.getElementById(targetId);
                if (targetElement) targetElement.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
    document.getElementById('mobile-menu-button').addEventListener('click', () => document.getElementById('mobile-menu').classList.toggle('hidden'));
    document.getElementById('use-my-location-btn').addEventListener('click', () => locateUser(false));
    document.getElementById('close-booking-modal').addEventListener('click', closeBookingModal);
    document.getElementById('booking-back-btn').addEventListener('click', () => navigateBookingStep('back'));
    document.getElementById('booking-next-btn').addEventListener('click', () => navigateBookingStep('next'));
    document.querySelectorAll('input[name="service-option"]').forEach(radio => radio.addEventListener('change', () => {
        document.getElementById('pickup-fee-display').textContent = `+${currencyFormatter.format(document.querySelector('input[name="service-option"]:checked').value === 'pickup' ? pickupFee : 0)}`;
    }));
    document.querySelectorAll('input[name="payment-option"]').forEach(radio => radio.addEventListener('change', () => showBookingStep(3)));
    document.getElementById('close-qr-modal').addEventListener('click', closeQrModal);
}
