import { useState, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import axios from "axios";

function App() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    axios.get("http://localhost:3000/slots")
      .then(res => setEvents(res.data))
      .catch(console.error);
  }, []);

  const handleDateClick = (info) => {
    alert(`Vous avez cliqué sur le créneau: ${info.dateStr}`);
  };

  return (
    <div>
      <h1 style={{ color: "#2E7D32" }}>GPAE - Planning Auto École</h1>
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        events={events}
        allDaySlot={false}
        slotDuration="01:00:00"
        dateClick={handleDateClick}
      />
    </div>
  );
}

export default App;
