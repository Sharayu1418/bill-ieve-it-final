import React, { useState } from 'react';
import { StarIcon } from 'lucide-react';

const TrackBillButton = () => {
  const [isClicked, setIsClicked] = useState(false);

  return (
    <button
      onClick={() => setIsClicked(!isClicked)}
      className="p-2 rounded-full transition-colors hover:bg-gray-100"
    >
      <StarIcon 
        className={`h-6 w-6 transition-colors ${
          isClicked ? 'text-yellow-400 fill-yellow-400' : 'text-gray-500'
        }`}
      />
    </button>
  );
};

export default TrackBillButton;