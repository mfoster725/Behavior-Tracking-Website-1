// Standard time periods
const STANDARD_PERIODS = [
    { time: 'AM Bus', location: 'Bus' },
    { time: '7:45-8:30', location: 'Bkfst' },
    { time: '8:30-9:00', location: 'English' },
    { time: '9:00-9:30', location: 'Math' },
    { time: '9:30-10:00', location: 'Science' },
    { time: '10:00-10:30', location: 'Group' },
    { time: '10:30-11:00', location: 'Group' },
    { time: '11:00-11:30', location: 'Individual' },
    { time: '11:30-12:00', location: 'Lunch' },
    { time: '12:00-12:30', location: 'Phys Ed' },
    { time: '12:30-1:00', location: 'Social' },
    { time: '1:00-1:30', location: 'Individual' },
    { time: '1:30-2:00', location: 'Studio' },
    { time: '2:00-2:30', location: 'Studio' },
    { time: '2:30-2:45', location: 'Homeroom' },
    { time: 'PM Bus', location: 'Bus' }
];

// Schedule periods for the schedules tab - automatically loaded in teacher and student schedule tables
const SCHEDULE_PERIODS = [
    'AM Bus',
    '7:45-8:30',
    '8:30-9:00',
    '9:00-9:30',
    '9:30-10:00',
    '10:00-10:30',
    '10:30-11:00',
    '11:00-11:30',
    '11:30-12:00',
    '12:00-12:30',
    '12:30-1:00',
    '1:00-1:30',
    '1:30-2:00',
    '2:00-2:30',
    '2:30-2:45',
    'PM Bus'
];

const INFRACTION_TYPES = {
    general: ['Lang', 'NFD', 'Off Task', 'MYOB', 'Self Control', 'Shutdown', 'Volume', 'Attention Seeking', 'Refusal', 'Personal Space'],
    harmful: ['Walk', 'Aggression', 'Property Destruction', 'Sexual Reference', 'Threat', 'Disrespectful']
};
