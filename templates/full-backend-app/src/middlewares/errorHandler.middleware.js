import { ApiError } from '../utils/index.js';

const errorHandler = (err, _, res, next) => {
    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
            statusCode: err.statusCode,
            success: err.success,
            message: err.message,
            error: err.error || [],
        });
    } else {
        console.log(err);
        return res.status(500).json({
            statusCode: 500,
            success: false,
            message: 'Internal Server Error!',
            error: [],
        });
    }
};

export { errorHandler };
